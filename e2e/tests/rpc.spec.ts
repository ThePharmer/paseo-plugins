import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  connectExplorerClient,
  type ExplorerClient,
  expectError,
  expectOk,
} from "../support/client";
import { BLOB_BYTES, NOTES_MD, ROOT_ENTRY_NAMES } from "../support/fixtures";
import { defaultFolders, readState } from "../support/state";

// Plugin RPCs called the way a Paseo client calls them, against the daemon from global setup.

const state = readState();
const { allowed, missing, outside, secret } = state.fixtures;
const CHUNK_LENGTH = 100_000;

let client: ExplorerClient;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  client = await connectExplorerClient(state.port, state.pluginId);
});

test.afterAll(async () => {
  await client?.close();
});

test("settings write saves the allowed folders", async () => {
  const saved = await client.writeAllowedFolders(defaultFolders(state));
  expect(saved.status).toBe("saved");
});

test("folders.list reports each folder with its status, including a missing one", async () => {
  const result = await client.listFolders();
  expect(result.folders).toEqual([
    { root: allowed, label: "QA", status: "ready" },
    { root: missing, label: path.basename(missing), status: "missing" },
  ]);
});

test("root listing shows dotfiles and hides a symlink that escapes the folder", async () => {
  const { directory } = expectOk(await client.listDirectory(allowed));
  const names = directory.entries.map((entry) => entry.name).sort();
  expect(names).toEqual(ROOT_ENTRY_NAMES);
});

test("subdirectory listing returns root-relative paths", async () => {
  const { directory } = expectOk(await client.listDirectory(allowed, "src"));
  expect(directory.entries).toEqual([
    expect.objectContaining({ name: "index.ts", path: "src/index.ts", kind: "file" }),
  ]);
});

test("reads a text file as utf-8", async () => {
  const { file } = expectOk(await client.readFile(allowed, "notes.md"));
  expect(file).toMatchObject({ kind: "text", encoding: "utf-8", content: NOTES_MD });
});

test("reads an image as base64 with its mime type", async () => {
  const { file } = expectOk(await client.readFile(allowed, "swatch.png"));
  expect(file).toMatchObject({ kind: "image", encoding: "base64", mimeType: "image/png" });
  const bytes = await readFile(path.join(allowed, "swatch.png"));
  expect(file.content).toBe(bytes.toString("base64"));
});

test("reads a binary file as metadata without content", async () => {
  const { file } = expectOk(await client.readFile(allowed, "blob.bin"));
  expect(file).toMatchObject({ kind: "binary", size: BLOB_BYTES });
  expect(file.content).toBeUndefined();
});

test("refuses a symlink that resolves outside the folder", async () => {
  test.skip(!state.fixtures.hasEscapeLink, "symlinks are not created on Windows");
  const result = expectError(await client.readFile(allowed, "escape-link.txt"));
  expect(result.error).toMatch(/outside/i);
});

test("refuses ../ traversal", async () => {
  expectError(await client.listDirectory(allowed, `../${path.basename(outside)}`));
});

test("refuses an absolute path outside the folder", async () => {
  const result = expectError(await client.readFile(allowed, secret));
  expect(JSON.stringify(result)).not.toContain("top secret");
});

test("refuses a root that is not in the allowed list", async () => {
  const result = expectError(await client.listDirectory(outside));
  expect(result.error).toMatch(/allowed folders list/);
});

test('refuses "/" as a root', async () => {
  expectError(await client.listDirectory("/"));
});

test("chunked download reassembles the exact bytes", async () => {
  const parts: Buffer[] = [];
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  let revision: string | undefined;
  while (offset < size) {
    const chunk = expectOk(
      await client.readChunk({
        root: allowed,
        path: "blob.bin",
        offset,
        length: CHUNK_LENGTH,
        ...(revision ? { expectedRevision: revision } : {}),
      }),
    );
    expect(chunk.fileName).toBe("blob.bin");
    revision = chunk.revision;
    size = chunk.size;
    const bytes = Buffer.from(chunk.base64, "base64");
    expect(bytes.length).toBeGreaterThan(0);
    parts.push(bytes);
    offset += bytes.length;
  }
  expect(parts).toHaveLength(Math.ceil(BLOB_BYTES / CHUNK_LENGTH));
  const expected = sha256(await readFile(path.join(allowed, "blob.bin")));
  expect(sha256(Buffer.concat(parts))).toBe(expected);
});

test("rejects a chunk length above the 2 MiB maximum", async () => {
  // The daemon validates the input schema before the handler runs, so the call itself fails.
  await expect(
    client.readChunk({ root: allowed, path: "blob.bin", offset: 0, length: 3 * 1024 * 1024 }),
  ).rejects.toThrow(/2097152|too_big|too big|invalid/i);
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
