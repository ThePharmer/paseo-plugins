import { constants, promises as fs, type BigIntStats } from "node:fs";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type {
  AllowedFolder,
  listDirectoryRpc,
  listFoldersRpc,
  readFileChunkRpc,
  readFileRpc,
} from "../shared/rpc";
import type { AllowedFolderSetting, explorerSettings } from "../shared/settings";
import {
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  resolveExplorerFilePath,
} from "./explorer/service";
import { expandUserPath } from "./explorer/path-utils";

// Files above this size are refused even when the client asks for more. Matches the core file
// pane's largest highlighted preview on web (packages/app/src/file-pane/source/presentation.ts).
const MAX_READ_BYTES = 10 * 1024 * 1024;

type ExplorerSettings = PluginSettings<(typeof explorerSettings)["schema"]>;

export class FolderNotAllowedError extends Error {
  constructor(readonly root: string) {
    super("Folder is not in the allowed folders list");
    this.name = "FolderNotAllowedError";
  }
}

export interface ExplorerHandlers {
  listFolders(input: RpcInput<typeof listFoldersRpc>): Promise<RpcOutput<typeof listFoldersRpc>>;
  listDirectory(
    input: RpcInput<typeof listDirectoryRpc>,
  ): Promise<RpcOutput<typeof listDirectoryRpc>>;
  readFile(input: RpcInput<typeof readFileRpc>): Promise<RpcOutput<typeof readFileRpc>>;
  readFileChunk(
    input: RpcInput<typeof readFileChunkRpc>,
  ): Promise<RpcOutput<typeof readFileChunkRpc>>;
}

export function createExplorerHandlers(settings: ExplorerSettings): ExplorerHandlers {
  async function configuredFolders(): Promise<AllowedFolderSetting[]> {
    const state = await settings.read();
    if (state.status !== "ready") {
      throw new Error(`File explorer settings are invalid: ${state.error}`);
    }
    return state.values.folders;
  }

  // The only way a client names a folder is by the expanded root returned from listFolders.
  // Anything else is refused before it reaches the filesystem.
  async function requireAllowedRoot(root: string): Promise<string> {
    const allowed = new Set((await configuredFolders()).map((folder) => expandUserPath(folder.path)));
    if (!allowed.has(root)) {
      throw new FolderNotAllowedError(root);
    }
    return root;
  }

  return {
    async listFolders() {
      const seen = new Set<string>();
      const folders: AllowedFolder[] = [];
      for (const folder of await configuredFolders()) {
        const root = expandUserPath(folder.path);
        if (seen.has(root)) continue;
        seen.add(root);
        folders.push({
          root,
          label: folder.label ?? (path.basename(root) || root),
          status: await folderStatus(root),
        });
      }
      return { folders };
    },

    async listDirectory({ root, path: relativePath }) {
      try {
        const directory = await listDirectoryEntries({
          root: await requireAllowedRoot(root),
          relativePath,
        });
        return { status: "ok", directory };
      } catch (error) {
        return { status: "error", error: errorMessage(error) };
      }
    },

    async readFile({ root, path: relativePath, maxBytes }) {
      try {
        const allowedRoot = await requireAllowedRoot(root);
        await requireRegularFile(allowedRoot, relativePath);
        const limit = Math.min(maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);
        const info = await getDownloadableFileInfo({ root: allowedRoot, relativePath });
        if (info.size > limit) {
          return { status: "error", error: "File is too large to display" };
        }
        const file = await readExplorerFile({ root: allowedRoot, relativePath });
        return { status: "ok", file };
      } catch (error) {
        return { status: "error", error: errorMessage(error) };
      }
    },

    async readFileChunk({ root, path: relativePath, offset, length, expectedRevision }) {
      try {
        const allowedRoot = await requireAllowedRoot(root);
        await requireRegularFile(allowedRoot, relativePath);
        const info = await getDownloadableFileInfo({ root: allowedRoot, relativePath });
        const resolvedPath = await resolveExplorerFilePath({ root: allowedRoot, relativePath });
        const handle = await fs.open(resolvedPath, READ_FLAGS);
        try {
          const stats = await handle.stat({ bigint: true });
          if (!stats.isFile()) {
            return { status: "error", error: "Requested path is not a file" };
          }
          const revision = fileRevision(stats);
          if (expectedRevision !== undefined && expectedRevision !== revision) {
            return { status: "changed", revision };
          }
          const size = Number(stats.size);
          const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          return {
            status: "ok",
            base64: buffer.subarray(0, bytesRead).toString("base64"),
            size,
            revision,
            fileName: info.fileName,
            mimeType: info.mimeType,
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        return { status: "error", error: errorMessage(error) };
      }
    },
  };
}

// Same flags and revision format as the explorer service, so revisions compare across RPCs.
const READ_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

function fileRevision(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

// The service opens a file before checking what it is, and opening a FIFO blocks until a writer
// appears, tying up a libuv thread for good. stat never blocks, so refuse non-regular files first.
async function requireRegularFile(root: string, relativePath: string): Promise<void> {
  const resolvedPath = await resolveExplorerFilePath({ root, relativePath });
  const stats = await fs.stat(resolvedPath);
  if (!stats.isFile()) throw new Error("Requested path is not a file");
}

async function folderStatus(root: string): Promise<AllowedFolder["status"]> {
  try {
    const stats = await fs.stat(root);
    return stats.isDirectory() ? "ready" : "not-directory";
  } catch {
    return "missing";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
