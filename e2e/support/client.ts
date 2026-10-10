import { randomUUID } from "node:crypto";
// The public SDK entry (createPaseoClient) has no plugin RPC call yet. The CLI builds this same
// DaemonClient from this export-mapped subpath (@getpaseo/cli dist/utils/client.js), so it is as
// stable as the CLI's own plugin commands.
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { settingsRpc } from "@getpaseo/plugin";
import { WebSocket } from "ws";

export const PLUGIN_ID = "file-explorer";

// Result shapes of the plugin's RPCs (file-explorer/shared/rpc.ts), written out here so the suite
// checks the wire contract instead of importing it.

export interface AllowedFolderSetting {
  path: string;
  label?: string;
}

export interface AllowedFolder {
  root: string;
  label: string;
  status: "ready" | "missing" | "not-directory";
}

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
}

export interface ExplorerFile {
  path: string;
  kind: "text" | "image" | "binary";
  encoding: "utf-8" | "base64" | "none";
  content?: string;
  mimeType?: string;
  size: number;
  modifiedAt: string;
  revision: string;
}

export interface ErrorResult {
  status: "error";
  error: string;
}

export interface DirectoryOk {
  status: "ok";
  directory: { path: string; entries: ExplorerEntry[] };
}

export interface FileOk {
  status: "ok";
  file: ExplorerFile;
}

export interface ChunkOk {
  status: "ok";
  base64: string;
  size: number;
  revision: string;
  fileName: string;
  mimeType: string;
}

export interface ChunkChanged {
  status: "changed";
  revision: string;
}

export interface ChunkInput {
  root: string;
  path: string;
  offset: number;
  length: number;
  expectedRevision?: string;
}

export interface SettingsWriteResult {
  status: string;
  revision?: string;
  error?: string;
}

export interface ExplorerClient {
  listFolders(): Promise<{ folders: AllowedFolder[] }>;
  listDirectory(root: string, path?: string): Promise<DirectoryOk | ErrorResult>;
  readFile(root: string, path: string): Promise<FileOk | ErrorResult>;
  readChunk(input: ChunkInput): Promise<ChunkOk | ChunkChanged | ErrorResult>;
  writeAllowedFolders(folders: AllowedFolderSetting[]): Promise<SettingsWriteResult>;
  /** Empties the plugin's remembered open-file tabs. */
  clearOpenFiles(): Promise<SettingsWriteResult>;
  close(): Promise<void>;
}

export async function connectExplorerClient(
  port: number,
  pluginId = PLUGIN_ID,
): Promise<ExplorerClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId: `e2e-${randomUUID()}`,
    clientType: "cli",
    connectTimeoutMs: 15_000,
    webSocketFactory: (url, config) =>
      new WebSocket(url, config?.protocols, { headers: config?.headers }) as never,
    reconnect: { enabled: false },
  });
  await client.connect();

  function call<T>(method: string, input: unknown): Promise<T> {
    return client.invokePluginRpc(pluginId, method, input) as Promise<T>;
  }

  async function writeSettings(id: string, values: unknown): Promise<SettingsWriteResult> {
    const rpc = settingsRpc(id);
    const current = await call<{ revision: string }>(rpc.read.name, {});
    return call(rpc.write.name, { revision: current.revision, values });
  }

  return {
    listFolders: () => call("explorer.folders.list", {}),
    listDirectory: (root, path) =>
      call("explorer.directory.list", path === undefined ? { root } : { root, path }),
    readFile: (root, path) => call("explorer.file.read", { root, path }),
    readChunk: (input) => call("explorer.file.chunk", input),
    writeAllowedFolders: (folders) => writeSettings("explorer", { folders }),
    clearOpenFiles: () => writeSettings("open-files", { files: [] }),
    close: () => client.close().catch(() => undefined),
  };
}

/** Narrows an RPC result to its ok branch, failing with the whole payload otherwise. */
export function expectOk<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  if (result.status !== "ok") throw new Error(`Expected status ok, got ${JSON.stringify(result)}`);
  return result as Extract<T, { status: "ok" }>;
}

export function expectError<T extends { status: string }>(result: T): ErrorResult {
  if (result.status !== "error") {
    throw new Error(`Expected status error, got ${JSON.stringify(result).slice(0, 500)}`);
  }
  return result as unknown as ErrorResult;
}
