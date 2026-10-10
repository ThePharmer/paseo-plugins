import type { z } from "zod";
import { type OpenFile, openFilesRpc, openFilesSettings } from "../../shared/open-files";
import { fileKey } from "./panel-id";

// The open-file list is a read-modify-write of one host settings document. Other clients of the
// same host write it too, so every write carries the revision it was computed from and a conflict
// re-reads and re-applies the change.

export const MAX_OPEN_FILES = 20;
const MAX_WRITE_ATTEMPTS = 3;

export type OpenFilesReadResult = z.output<(typeof openFilesRpc)["read"]["output"]>;
export type OpenFilesWriteInput = z.input<(typeof openFilesRpc)["write"]["input"]>;
export type OpenFilesWriteResult = z.output<(typeof openFilesRpc)["write"]["output"]>;

/** The settings RPCs for the open-files document, injected so tests can fake the host. */
export interface OpenFilesStorage {
  read(): Promise<OpenFilesReadResult>;
  write(input: OpenFilesWriteInput): Promise<OpenFilesWriteResult>;
}

export interface OpenFilesSnapshot {
  revision: string;
  files: OpenFile[];
}

export interface PersistedOpenFiles {
  /** The list before this write, as read from the host. */
  previous: OpenFile[];
  /** The list the host saved. */
  files: OpenFile[];
}

export class OpenFilesWriteError extends Error {
  constructor(
    readonly reason: "conflict" | "invalid",
    readonly detail: string,
  ) {
    super(
      reason === "conflict"
        ? "The open file list kept changing on the host"
        : `The host rejected the open file list: ${detail}`,
    );
    this.name = "OpenFilesWriteError";
  }
}

/** Moves the file to the front, dropping an older entry for it and anything past the cap. */
export function recordOpenFile(
  files: readonly OpenFile[],
  file: OpenFile,
  cap: number = MAX_OPEN_FILES,
): OpenFile[] {
  const key = fileKey(file);
  const rest = files.filter((candidate) => fileKey(candidate) !== key);
  return [file, ...rest].slice(0, cap);
}

/**
 * An unreadable document counts as empty, keeping its revision so the next write replaces it:
 * the list only exists to restore tabs, and refusing to open files over it would be worse.
 */
export function parseOpenFiles(result: OpenFilesReadResult): OpenFilesSnapshot {
  if (result.status === "invalid") return { revision: result.revision, files: [] };
  const parsed = openFilesSettings.schema.safeParse(result.values);
  return { revision: result.revision, files: parsed.success ? parsed.data.files : [] };
}

export async function readOpenFiles(storage: OpenFilesStorage): Promise<OpenFile[]> {
  return parseOpenFiles(await storage.read()).files;
}

export async function persistOpenFile(
  storage: OpenFilesStorage,
  file: OpenFile,
): Promise<PersistedOpenFiles> {
  let lastConflict = "";
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = parseOpenFiles(await storage.read());
    const files = recordOpenFile(current.files, file);
    const result = await storage.write({ revision: current.revision, values: { files } });
    if (result.status === "saved") return { previous: current.files, files };
    if (result.status === "invalid") throw new OpenFilesWriteError("invalid", result.error);
    lastConflict = result.error;
  }
  throw new OpenFilesWriteError("conflict", lastConflict);
}
