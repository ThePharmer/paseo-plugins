import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AllowedFolderSetting, explorerSettings } from "../shared/settings";
import { createExplorerHandlers } from "./handlers";

type Schema = (typeof explorerSettings)["schema"];

function settingsWith(state: PluginSettingsState<Schema>): PluginSettings<Schema> {
  return { read: async () => state, subscribe: () => () => {} };
}

function handlersFor(folders: AllowedFolderSetting[]) {
  return createExplorerHandlers(settingsWith({ status: "ready", revision: "1", values: { folders } }));
}

let sandbox: string;
let allowed: string;
let outside: string;

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(path.join(os.tmpdir(), "file-explorer-plugin-")));
  allowed = path.join(sandbox, "allowed");
  outside = path.join(sandbox, "outside");
  await mkdir(path.join(allowed, "src"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(allowed, "src", "index.ts"), "export const answer = 42;\n");
  await writeFile(path.join(outside, "secret.txt"), "do not read\n");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("listFolders", () => {
  it("expands, labels and dedupes configured folders and reports missing ones", async () => {
    const handlers = handlersFor([
      { path: allowed },
      { path: `${allowed}/`, label: "Duplicate" },
      { path: path.join(sandbox, "gone"), label: "Gone" },
    ]);

    await expect(handlers.listFolders({})).resolves.toEqual({
      folders: [
        { root: allowed, label: "allowed", status: "ready" },
        { root: path.join(sandbox, "gone"), label: "Gone", status: "missing" },
      ],
    });
  });

  it("expands ~/ against the daemon user's home directory", async () => {
    const handlers = handlersFor([{ path: "~/" }]);

    const { folders } = await handlers.listFolders({});

    expect(folders.map((folder) => folder.root)).toEqual([os.homedir()]);
  });

  it("fails loudly when the stored settings are invalid", async () => {
    const handlers = createExplorerHandlers(
      settingsWith({ status: "invalid", revision: "1", error: "bad folders" }),
    );

    await expect(handlers.listFolders({})).rejects.toThrow("bad folders");
  });
});

describe("listDirectory", () => {
  it("lists a directory inside an allowed folder", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    const result = await handlers.listDirectory({ root: allowed, path: "src" });

    expect(result).toMatchObject({
      status: "ok",
      directory: { path: "src", entries: [{ name: "index.ts", path: "src/index.ts", kind: "file" }] },
    });
  });

  it("refuses a root that is not in the allowed list", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    await expect(handlers.listDirectory({ root: outside })).resolves.toEqual({
      status: "error",
      error: "Folder is not in the allowed folders list",
    });
  });

  it("refuses a path that climbs out of the allowed folder", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    await expect(handlers.listDirectory({ root: allowed, path: "../outside" })).resolves.toEqual({
      status: "error",
      error: "Access outside of the allowed folder is not allowed",
    });
  });

  it("hides symlinks that resolve outside the allowed folder", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(allowed, "secret-link.txt"));
    await symlink(path.join(allowed, "src", "index.ts"), path.join(allowed, "inside-link.ts"));
    const handlers = handlersFor([{ path: allowed }]);

    const result = await handlers.listDirectory({ root: allowed });

    if (result.status !== "ok") throw new Error(result.error);
    expect(result.directory.entries.map((entry) => entry.name).sort()).toEqual([
      "inside-link.ts",
      "src",
    ]);
  });
});

describe("readFile", () => {
  it("reads a text file inside an allowed folder", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    const result = await handlers.readFile({ root: allowed, path: "src/index.ts" });

    expect(result).toMatchObject({
      status: "ok",
      file: { path: "src/index.ts", kind: "text", encoding: "utf-8", content: "export const answer = 42;\n" },
    });
  });

  it("refuses to read through a symlink that resolves outside the allowed folder", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(allowed, "secret-link.txt"));
    const handlers = handlersFor([{ path: allowed }]);

    await expect(handlers.readFile({ root: allowed, path: "secret-link.txt" })).resolves.toEqual({
      status: "error",
      error: "Access outside of the allowed folder is not allowed",
    });
  });

  it("refuses an absolute path outside the allowed folder", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    await expect(
      handlers.readFile({ root: allowed, path: path.join(outside, "secret.txt") }),
    ).resolves.toEqual({
      status: "error",
      error: "Access outside of the allowed folder is not allowed",
    });
  });

  it("refuses files larger than the requested limit", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    await expect(
      handlers.readFile({ root: allowed, path: "src/index.ts", maxBytes: 4 }),
    ).resolves.toEqual({ status: "error", error: "File is too large to display" });
  });

  it("caps the client's limit at the server maximum", async () => {
    await writeFile(path.join(allowed, "big.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    const handlers = handlersFor([{ path: allowed }]);

    await expect(
      handlers.readFile({ root: allowed, path: "big.txt", maxBytes: 100 * 1024 * 1024 }),
    ).resolves.toEqual({ status: "error", error: "File is too large to display" });
  });
});

describe("readFileChunk", () => {
  it("reads a binary file in chunks with a stable revision", async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 254, 255, 7, 8, 9]);
    await writeFile(path.join(allowed, "blob.bin"), bytes);
    const handlers = handlersFor([{ path: allowed }]);

    const first = await handlers.readFileChunk({ root: allowed, path: "blob.bin", offset: 0, length: 4 });
    if (first.status !== "ok") throw new Error(JSON.stringify(first));
    const second = await handlers.readFileChunk({
      root: allowed,
      path: "blob.bin",
      offset: 4,
      length: 100,
      expectedRevision: first.revision,
    });
    if (second.status !== "ok") throw new Error(JSON.stringify(second));

    expect(Buffer.concat([Buffer.from(first.base64, "base64"), Buffer.from(second.base64, "base64")])).toEqual(bytes);
    expect(first).toMatchObject({ size: 9, fileName: "blob.bin", mimeType: "application/octet-stream" });
    expect(second.revision).toBe(first.revision);
  });

  it("reports a file that changed since the first chunk", async () => {
    const filePath = path.join(allowed, "notes.txt");
    await writeFile(filePath, "first version");
    const handlers = handlersFor([{ path: allowed }]);
    const first = await handlers.readFileChunk({ root: allowed, path: "notes.txt", offset: 0, length: 4 });
    if (first.status !== "ok") throw new Error(JSON.stringify(first));

    await writeFile(filePath, "second, longer version");
    const next = await handlers.readFileChunk({
      root: allowed,
      path: "notes.txt",
      offset: 4,
      length: 4,
      expectedRevision: first.revision,
    });

    expect(next.status).toBe("changed");
  });

  it("returns an empty chunk past the end of the file", async () => {
    const handlers = handlersFor([{ path: allowed }]);

    const result = await handlers.readFileChunk({ root: allowed, path: "src/index.ts", offset: 1000, length: 10 });

    expect(result).toMatchObject({ status: "ok", base64: "" });
  });

  it("refuses chunks through a symlink that leaves the allowed folder", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(allowed, "secret-link.txt"));
    const handlers = handlersFor([{ path: allowed }]);

    await expect(
      handlers.readFileChunk({ root: allowed, path: "secret-link.txt", offset: 0, length: 10 }),
    ).resolves.toEqual({ status: "error", error: "Access outside of the allowed folder is not allowed" });
  });
});

describe("path edge cases", () => {
  it("lists and reads names that only start with two dots", async () => {
    await writeFile(path.join(allowed, "..notes.txt"), "dots\n");
    await mkdir(path.join(allowed, "...dir"));
    const handlers = handlersFor([{ path: allowed }]);

    const result = await handlers.listDirectory({ root: allowed });
    if (result.status !== "ok") throw new Error(result.error);
    expect(result.directory.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["..notes.txt", "...dir"]),
    );
    await expect(handlers.readFile({ root: allowed, path: "..notes.txt" })).resolves.toMatchObject({
      status: "ok",
      file: { content: "dots\n" },
    });
  });

  it("treats an entry named ~ as a folder inside the root, not the home directory", async () => {
    await mkdir(path.join(allowed, "~"));
    await writeFile(path.join(allowed, "~", "inside.txt"), "tilde\n");
    const handlers = handlersFor([{ path: allowed }]);

    await expect(handlers.listDirectory({ root: allowed, path: "~" })).resolves.toMatchObject({
      status: "ok",
      directory: { path: "~", entries: [{ name: "inside.txt", path: "~/inside.txt" }] },
    });
    await expect(handlers.readFile({ root: allowed, path: "~/inside.txt" })).resolves.toMatchObject({
      status: "ok",
      file: { content: "tilde\n" },
    });
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO without blocking", async () => {
    execFileSync("mkfifo", [path.join(allowed, "pipe")]);
    const handlers = handlersFor([{ path: allowed }]);

    await expect(handlers.readFile({ root: allowed, path: "pipe" })).resolves.toEqual({
      status: "error",
      error: "Requested path is not a file",
    });
    await expect(
      handlers.readFileChunk({ root: allowed, path: "pipe", offset: 0, length: 10 }),
    ).resolves.toEqual({ status: "error", error: "Requested path is not a file" });
  }, 2000);
});
