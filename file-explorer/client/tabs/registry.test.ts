import type { PluginWorkspacePanelContribution } from "@getpaseo/plugin/client";
import { describe, expect, it } from "vitest";
import type { OpenFile } from "../../shared/open-files";
import { createFallbackSelectionStore } from "./fallback-selection";
import type { LocalOpenFiles } from "./local-open-files";
import {
  MAX_OPEN_FILES,
  type OpenFilesReadResult,
  type OpenFilesStorage,
  type OpenFilesWriteInput,
  type OpenFilesWriteResult,
} from "./open-files";
import { filePanelId, type FileRef } from "./panel-id";
import { createFileTabs, FALLBACK_PANEL_ID, type OpenFileTabOutcome } from "./registry";

class MemoryStorage implements OpenFilesStorage {
  revision = 0;
  files: OpenFile[] = [];
  reads = 0;
  /** Holds the next read's answer, taken when it was called, until the promise settles. */
  nextReadGate: Promise<void> | null = null;

  async read(): Promise<OpenFilesReadResult> {
    this.reads += 1;
    const result: OpenFilesReadResult = {
      status: "ready",
      revision: String(this.revision),
      values: { files: this.files },
    };
    const gate = this.nextReadGate;
    this.nextReadGate = null;
    if (gate) await gate;
    return result;
  }

  async write(input: OpenFilesWriteInput): Promise<OpenFilesWriteResult> {
    if (input.revision !== String(this.revision)) return { status: "conflict", error: "stale" };
    this.revision += 1;
    const values = input.values;
    this.files = isFileList(values) ? values.files : [];
    return { status: "saved", revision: String(this.revision), values };
  }
}

function isFileList(value: unknown): value is { files: OpenFile[] } {
  return typeof value === "object" && value !== null && "files" in value;
}

/** This device's local copy; null stands for storage that is unavailable or empty. */
class MemoryLocal implements LocalOpenFiles {
  writes = 0;
  constructor(public files: OpenFile[] | null = null) {}

  readSync(): OpenFile[] | null {
    return this.files ? [...this.files] : null;
  }

  write(files: readonly OpenFile[]): void {
    this.writes += 1;
    this.files = [...files];
  }
}

function Panel() {
  return null;
}

interface HarnessOptions {
  refuseFilePanels?: boolean;
  local?: OpenFile[];
  hostFiles?: OpenFile[];
}

/** Stands in for the app: tracks registered panels and opened tabs, and can refuse registration. */
function createHarness(options: HarnessOptions = {}) {
  const storage = new MemoryStorage();
  storage.files = options.hostFiles ?? [];
  const local = new MemoryLocal(options.local ?? null);
  const panels = new Map<string, PluginWorkspacePanelContribution>();
  const registrations: string[] = [];
  const opened: string[] = [];
  const fallback = createFallbackSelectionStore();
  let clock = 0;
  const tabs = createFileTabs({
    host: {
      addWorkspacePanel(contribution) {
        registrations.push(contribution.id);
        if (panels.has(contribution.id))
          throw new Error(`Duplicate workspace panel: ${contribution.id}`);
        if (options.refuseFilePanels && contribution.id !== FALLBACK_PANEL_ID) {
          throw new Error("Runtime registration is unavailable");
        }
        panels.set(contribution.id, contribution);
        return () => {
          panels.delete(contribution.id);
        };
      },
      openPanel(panelId, workspaceId) {
        if (!panels.has(panelId)) throw new Error(`Workspace panel is unavailable: ${panelId}`);
        opened.push(`${workspaceId}:${panelId}`);
      },
      storage,
      local,
      now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, clock++)).toISOString(),
    },
    panels: {
      filePanel: (ref, panelId) => ({
        id: panelId,
        title: ref.path.split("/").pop() ?? ref.path,
        icon: "File",
        context: "workspace",
        locations: ["workspace"],
        Component: Panel,
      }),
      fallbackPanel: () => ({
        id: FALLBACK_PANEL_ID,
        title: "File",
        icon: "File",
        context: "workspace",
        locations: ["workspace"],
        Component: Panel,
      }),
    },
    fallback,
  });
  return { tabs, storage, local, panels, registrations, opened, fallback };
}

function file(path: string): FileRef {
  return { root: "/r", path };
}

function stored(path: string, root = "/r"): OpenFile {
  return { root, path, openedAt: "2026-09-01T00:00:00.000Z" };
}

function paths(files: readonly OpenFile[] | null): string[] {
  return (files ?? []).map((entry) => `${entry.root}:${entry.path}`);
}

async function settled(outcome: OpenFileTabOutcome): Promise<void> {
  if (outcome.tab === "file") await outcome.persisted;
}

describe("createFileTabs", () => {
  it("registers a panel for the file, opens it, and persists it", async () => {
    const { tabs, storage, panels, opened } = createHarness();

    const outcome = tabs.open({ ...file("src/a.ts"), workspaceId: "w1" });
    await settled(outcome);

    const id = filePanelId(file("src/a.ts"));
    expect(outcome).toMatchObject({ tab: "file", panelId: id });
    expect(panels.get(id)?.title).toBe("a.ts");
    expect(opened).toEqual([`w1:${id}`]);
    expect(storage.files.map((entry) => entry.path)).toEqual(["src/a.ts"]);
  });

  it("re-opens an already registered file and bumps it to the front", async () => {
    const { tabs, storage, panels, opened } = createHarness();

    await settled(tabs.open({ ...file("a"), workspaceId: "w1" }));
    await settled(tabs.open({ ...file("b"), workspaceId: "w1" }));
    await settled(tabs.open({ ...file("a"), workspaceId: "w2" }));

    expect(panels.size).toBe(2);
    expect(opened.at(-1)).toBe(`w2:${filePanelId(file("a"))}`);
    expect(storage.files.map((entry) => entry.path)).toEqual(["a", "b"]);
  });

  it("unregisters the least recently opened file when the list overflows", async () => {
    const { tabs, storage, panels } = createHarness();

    for (let index = 0; index <= MAX_OPEN_FILES; index += 1) {
      await settled(tabs.open({ ...file(`f${index}`), workspaceId: "w1" }));
    }

    expect(storage.files).toHaveLength(MAX_OPEN_FILES);
    expect(panels.size).toBe(MAX_OPEN_FILES);
    expect(tabs.isRegistered(file("f0"))).toBe(false);
    expect(tabs.isRegistered(file(`f${MAX_OPEN_FILES}`))).toBe(true);
  });

  it("keeps an evicted file registered while its tab is mounted on this client", async () => {
    const { tabs } = createHarness();
    await settled(tabs.open({ ...file("f0"), workspaceId: "w1" }));
    const unmount = tabs.trackMounted(file("f0"));

    for (let index = 1; index <= MAX_OPEN_FILES; index += 1) {
      await settled(tabs.open({ ...file(`f${index}`), workspaceId: "w1" }));
    }

    expect(tabs.isRegistered(file("f0"))).toBe(true);
    unmount();
    await settled(tabs.open({ ...file("f-next"), workspaceId: "w1" }));
    expect(tabs.isRegistered(file("f1"))).toBe(false);
  });

  it("does not unregister an evicted file whose reopen is still being saved", async () => {
    const { tabs, panels } = createHarness();
    for (let index = 0; index < MAX_OPEN_FILES; index += 1) {
      await settled(tabs.open({ ...file(`f${index}`), workspaceId: "w1" }));
    }

    // Opening "new" evicts f0, but f0 is reopened before that save lands.
    const first = tabs.open({ ...file("new"), workspaceId: "w1" });
    const second = tabs.open({ ...file("f0"), workspaceId: "w1" });
    await settled(first);
    await settled(second);

    expect(tabs.isRegistered(file("f0"))).toBe(true);
    expect(tabs.isRegistered(file("new"))).toBe(true);
    expect(tabs.isRegistered(file("f1"))).toBe(false);
    expect(panels.size).toBe(MAX_OPEN_FILES);
  });

  it("restores a panel for every persisted file", async () => {
    const { tabs, storage, panels } = createHarness();
    storage.files = [
      { root: "/r", path: "a", openedAt: "2026-10-01T00:00:00.000Z" },
      { root: "/r", path: "b", openedAt: "2026-09-01T00:00:00.000Z" },
    ];

    await tabs.restore();

    expect([...panels.keys()].sort()).toEqual(
      [filePanelId(file("a")), filePanelId(file("b"))].sort(),
    );
  });

  it("opens the shared fallback panel when per-file registration is refused", async () => {
    const { tabs, panels, opened, fallback, storage } = createHarness({ refuseFilePanels: true });

    const first = tabs.open({ ...file("a"), workspaceId: "w1" });
    const second = tabs.open({ ...file("b"), workspaceId: "w1" });

    expect(first).toEqual({ tab: "fallback" });
    expect(second).toEqual({ tab: "fallback" });
    expect([...panels.keys()]).toEqual([FALLBACK_PANEL_ID]);
    expect(opened).toEqual([`w1:${FALLBACK_PANEL_ID}`, `w1:${FALLBACK_PANEL_ID}`]);
    expect(fallback.get("w1")).toEqual(file("b"));
    expect(fallback.get("w2")).toBeNull();
    expect(storage.files).toEqual([]);
  });

  it("unregisters a new panel when the app refuses to open it", () => {
    const panels = new Map<string, PluginWorkspacePanelContribution>();
    const refusing = createFileTabs({
      host: {
        addWorkspacePanel: (contribution) => {
          panels.set(contribution.id, contribution);
          return () => {
            panels.delete(contribution.id);
          };
        },
        openPanel: () => {
          throw new Error("Plugin panel context is unavailable");
        },
        storage: new MemoryStorage(),
        local: new MemoryLocal(),
        now: () => "2026-10-01T00:00:00.000Z",
      },
      panels: {
        filePanel: (_file, panelId) => ({
          id: panelId,
          title: "a",
          icon: "File",
          context: "workspace",
          Component: Panel,
        }),
        fallbackPanel: () => {
          throw new Error("unused");
        },
      },
      fallback: createFallbackSelectionStore(),
    });

    expect(() => refusing.open({ ...file("a"), workspaceId: "gone" })).toThrow(
      "Plugin panel context is unavailable",
    );
    expect(panels.size).toBe(0);
    expect(refusing.isRegistered(file("a"))).toBe(false);
  });

  it("removes every panel on dispose and ignores a restore that lands afterwards", async () => {
    const { tabs, storage, panels } = createHarness();
    await settled(tabs.open({ ...file("a"), workspaceId: "w1" }));
    storage.files = [...storage.files, { root: "/r", path: "late", openedAt: "x" }];

    const restoring = tabs.restore();
    tabs.dispose();
    await restoring;

    expect(panels.size).toBe(0);
    expect(() => tabs.open({ ...file("b"), workspaceId: "w1" })).toThrow();
  });
});

describe("createFileTabs with a local copy of the list", () => {
  it("registers the local copy synchronously at creation, before the host is read", () => {
    const { panels, storage } = createHarness({ local: [stored("a"), stored("b")] });

    expect(storage.reads).toBe(0);
    expect([...panels.keys()].sort()).toEqual(
      [filePanelId(file("a")), filePanelId(file("b"))].sort(),
    );
  });

  it("adds the host's files on restore without registering any panel twice", async () => {
    const { tabs, local, panels, registrations } = createHarness({
      local: [stored("a"), stored("gone")],
      hostFiles: [stored("a"), stored("b")],
    });

    await tabs.restore();

    expect([...panels.keys()].sort()).toEqual(
      [filePanelId(file("a")), filePanelId(file("b"))].sort(),
    );
    expect(registrations.filter((id) => id === filePanelId(file("a")))).toHaveLength(1);
    expect(tabs.isRegistered(file("gone"))).toBe(false);
    expect(paths(local.files)).toEqual(["/r:a", "/r:b"]);
  });

  it("keeps a pre-registered panel the host does not list while its tab is mounted", async () => {
    const { tabs } = createHarness({ local: [stored("open-here")], hostFiles: [stored("a")] });
    tabs.trackMounted(file("open-here"));

    await tabs.restore();

    expect(tabs.isRegistered(file("open-here"))).toBe(true);
    expect(tabs.isRegistered(file("a"))).toBe(true);
  });

  it("keeps entries under roots the host does not list in the copy, unregistered", async () => {
    const elsewhere = stored("x", "/other-host");
    const { tabs, local } = createHarness({
      local: [elsewhere, stored("a")],
      hostFiles: [stored("a")],
    });

    await tabs.restore();

    expect(tabs.isRegistered(elsewhere)).toBe(false);
    expect(paths(local.files)).toEqual(["/r:a", "/other-host:x"]);
  });

  it("does not rewrite the copy when it already matches the host", async () => {
    const files = [stored("a"), stored("b")];
    const { tabs, local } = createHarness({ local: files, hostFiles: files });

    await tabs.restore();

    expect(local.writes).toBe(0);
  });

  it("keeps the pre-registered panels when the host read fails", async () => {
    const { tabs, storage, panels } = createHarness({ local: [stored("a")] });
    storage.read = async () => {
      throw new Error("offline");
    };

    await expect(tabs.restore()).rejects.toThrow("offline");

    expect([...panels.keys()]).toEqual([filePanelId(file("a"))]);
  });

  it("records an open in the copy before the save lands, then the host's saved list", async () => {
    const { tabs, local, storage } = createHarness({
      local: [stored("a")],
      hostFiles: [stored("a")],
    });

    const outcome = tabs.open({ ...file("b"), workspaceId: "w1" });
    expect(paths(local.files)).toEqual(["/r:b", "/r:a"]);
    await settled(outcome);

    expect(paths(local.files)).toEqual(paths(storage.files));
    expect(paths(local.files)).toEqual(["/r:b", "/r:a"]);
  });

  it("drops evicted files from the copy", async () => {
    const { tabs, local } = createHarness();

    for (let index = 0; index <= MAX_OPEN_FILES; index += 1) {
      await settled(tabs.open({ ...file(`f${index}`), workspaceId: "w1" }));
    }

    expect(local.files).toHaveLength(MAX_OPEN_FILES);
    expect(paths(local.files)).not.toContain("/r:f0");
    expect(paths(local.files)[0]).toBe(`/r:f${MAX_OPEN_FILES}`);
  });

  it("drops a pre-registered panel once a save shows the host no longer lists it", async () => {
    const { tabs, storage } = createHarness({ local: [stored("gone")] });
    storage.read = async () => {
      throw new Error("offline");
    };
    await expect(tabs.restore()).rejects.toThrow("offline");
    storage.read = MemoryStorage.prototype.read;

    await settled(tabs.open({ ...file("a"), workspaceId: "w1" }));

    expect(tabs.isRegistered(file("gone"))).toBe(false);
    expect(tabs.isRegistered(file("a"))).toBe(true);
  });

  it("ignores a restore read that a later save already superseded", async () => {
    const { tabs, local, storage } = createHarness({
      local: [stored("a")],
      hostFiles: [stored("a")],
    });
    let release = () => {};
    storage.nextReadGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const restoring = tabs.restore();
    await settled(tabs.open({ ...file("b"), workspaceId: "w1" }));
    release();
    await restoring;

    expect(paths(local.files)).toEqual(["/r:b", "/r:a"]);
    expect(tabs.isRegistered(file("b"))).toBe(true);
  });

  it("does not record files that open in the fallback panel", () => {
    const { tabs, local } = createHarness({ refuseFilePanels: true });

    tabs.open({ ...file("a"), workspaceId: "w1" });

    expect(local.files).toBeNull();
  });
});
