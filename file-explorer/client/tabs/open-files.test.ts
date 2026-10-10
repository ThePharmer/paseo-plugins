import { describe, expect, it } from "vitest";
import type { OpenFile } from "../../shared/open-files";
import {
  MAX_OPEN_FILES,
  type OpenFilesReadResult,
  type OpenFilesStorage,
  type OpenFilesWriteInput,
  type OpenFilesWriteResult,
  OpenFilesWriteError,
  parseOpenFiles,
  persistOpenFile,
  recordOpenFile,
} from "./open-files";

function openFile(path: string, openedAt = "2026-10-01T00:00:00.000Z"): OpenFile {
  return { root: "/r", path, openedAt };
}

type StoredValues = Extract<OpenFilesReadResult, { status: "ready" }>["values"];

/** An in-memory host settings document with the daemon's revision check. */
class FakeSettingsHost implements OpenFilesStorage {
  revision = 0;
  values: StoredValues = { files: [] };
  writes: OpenFilesWriteInput[] = [];
  /** Runs before a write is checked, standing in for another client saving first. */
  beforeWrite: (() => void) | null = null;
  invalid: string | null = null;

  async read(): Promise<OpenFilesReadResult> {
    const revision = String(this.revision);
    if (this.invalid) return { status: "invalid", revision, error: this.invalid };
    return { status: "ready", revision, values: this.values };
  }

  async write(input: OpenFilesWriteInput): Promise<OpenFilesWriteResult> {
    this.writes.push(input);
    this.beforeWrite?.();
    if (input.revision !== String(this.revision)) {
      return { status: "conflict", error: "Settings changed" };
    }
    this.revision += 1;
    this.values = input.values;
    this.invalid = null;
    return { status: "saved", revision: String(this.revision), values: input.values };
  }

  /** Another client saving the document. */
  externalSave(files: OpenFile[]): void {
    this.revision += 1;
    this.values = { files };
  }
}

describe("recordOpenFile", () => {
  it("moves a reopened file to the front instead of duplicating it", () => {
    const files = [openFile("a"), openFile("b"), openFile("c")];

    const next = recordOpenFile(files, openFile("b", "2026-10-02T00:00:00.000Z"));

    expect(next.map((file) => file.path)).toEqual(["b", "a", "c"]);
    expect(next[0].openedAt).toBe("2026-10-02T00:00:00.000Z");
  });

  it("drops the least recently opened file past the cap", () => {
    const files = Array.from({ length: MAX_OPEN_FILES }, (_, index) => openFile(`f${index}`));

    const next = recordOpenFile(files, openFile("new"));

    expect(next).toHaveLength(MAX_OPEN_FILES);
    expect(next[0].path).toBe("new");
    expect(next.map((file) => file.path)).not.toContain(`f${MAX_OPEN_FILES - 1}`);
  });

  it("treats the same path under another root as another file", () => {
    const next = recordOpenFile([openFile("a")], { root: "/other", path: "a", openedAt: "x" });

    expect(next).toHaveLength(2);
  });
});

describe("parseOpenFiles", () => {
  it("reads an invalid or malformed document as empty, keeping its revision", () => {
    expect(parseOpenFiles({ status: "invalid", revision: "7", error: "bad" })).toEqual({
      revision: "7",
      files: [],
    });
    expect(parseOpenFiles({ status: "ready", revision: "8", values: { files: "nope" } })).toEqual({
      revision: "8",
      files: [],
    });
  });
});

describe("persistOpenFile", () => {
  it("saves the file at the front of the stored list with the read revision", async () => {
    const host = new FakeSettingsHost();
    host.externalSave([openFile("a")]);

    const saved = await persistOpenFile(host, openFile("b"));

    expect(saved.previous.map((file) => file.path)).toEqual(["a"]);
    expect(saved.files.map((file) => file.path)).toEqual(["b", "a"]);
    expect(host.writes).toEqual([{ revision: "1", values: { files: saved.files } }]);
  });

  it("re-reads and re-applies the change after a revision conflict", async () => {
    const host = new FakeSettingsHost();
    host.beforeWrite = () => {
      host.beforeWrite = null;
      host.externalSave([openFile("from-other-client")]);
    };

    const saved = await persistOpenFile(host, openFile("mine"));

    expect(host.writes).toHaveLength(2);
    expect(saved.files.map((file) => file.path)).toEqual(["mine", "from-other-client"]);
    expect(host.values).toEqual({ files: saved.files });
  });

  it("gives up with a conflict error when every attempt conflicts", async () => {
    const host = new FakeSettingsHost();
    host.beforeWrite = () => host.externalSave([]);

    const failure = persistOpenFile(host, openFile("mine"));

    await expect(failure).rejects.toBeInstanceOf(OpenFilesWriteError);
    await expect(failure).rejects.toMatchObject({ reason: "conflict" });
    expect(host.writes).toHaveLength(3);
  });

  it("replaces an invalid stored document", async () => {
    const host = new FakeSettingsHost();
    host.invalid = "Settings were saved by a newer plugin version";

    const saved = await persistOpenFile(host, openFile("a"));

    expect(saved.previous).toEqual([]);
    expect(host.values).toEqual({ files: [openFile("a")] });
  });

  it("surfaces a rejected write without retrying", async () => {
    const host = new FakeSettingsHost();
    host.write = async (input) => {
      host.writes.push(input);
      return { status: "invalid", error: "files: expected array" };
    };

    await expect(persistOpenFile(host, openFile("a"))).rejects.toMatchObject({
      reason: "invalid",
      detail: "files: expected array",
    });
    expect(host.writes).toHaveLength(1);
  });
});
