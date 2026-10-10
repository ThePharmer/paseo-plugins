import { MAX_FILE_CHUNK_BYTES } from "../../shared/rpc";
import { base64ByteLength } from "./base64";
import type { ReadFileChunk, SaveFileResult } from "./save-file";

// The largest multiple of 3 under the RPC limit. Every chunk but the last then encodes to base64
// without padding, so sinks that keep base64 can concatenate chunks into one valid string.
export const DOWNLOAD_CHUNK_BYTES = MAX_FILE_CHUNK_BYTES - (MAX_FILE_CHUNK_BYTES % 3);

const MB = 1024 * 1024;

// Native sinks hold base64 strings in the JS heap on some paths; browsers assemble a Blob.
export const DOWNLOAD_SIZE_LIMITS = {
  native: 50 * MB,
  web: 200 * MB,
} as const;

export const FILE_CHANGED_MESSAGE = "File changed during download, try again";

export interface DownloadedFile {
  fileName: string;
  mimeType: string;
  size: number;
}

/** Where downloaded bytes go. `begin` runs once, before the first `append`. */
export interface ChunkSink {
  begin(file: DownloadedFile): Promise<void>;
  append(base64: string): Promise<void>;
  finish(): Promise<SaveFileResult>;
  /** Releases anything `begin` created. Runs when the transfer fails after `begin`. */
  abort(): Promise<void>;
}

export interface TransferInput {
  root: string;
  path: string;
  readChunk: ReadFileChunk;
  sink: ChunkSink;
  maxBytes: number;
  onProgress?: (received: number, total: number) => void;
}

type ReadOutcome = { status: "complete" } | Exclude<SaveFileResult, { status: "saved" }>;

/** Streams a file into `sink` chunk by chunk, pinned to the revision of the first chunk. */
export async function transferFile(input: TransferInput): Promise<SaveFileResult> {
  let begun = false;
  try {
    const outcome = await readChunks(input, () => {
      begun = true;
    });
    if (outcome.status !== "complete") {
      if (begun) await abortSink(input.sink);
      return outcome;
    }
    return await input.sink.finish();
  } catch (error) {
    if (begun) await abortSink(input.sink);
    return { status: "error", error: errorMessage(error) };
  }
}

async function readChunks(input: TransferInput, onBegin: () => void): Promise<ReadOutcome> {
  const { root, path, readChunk, sink, maxBytes, onProgress } = input;
  let offset = 0;
  let revision: string | undefined;
  for (;;) {
    const chunk = await readChunk({
      root,
      path,
      offset,
      length: DOWNLOAD_CHUNK_BYTES,
      expectedRevision: revision,
    });
    if (chunk.status === "changed") {
      return { status: "error", error: FILE_CHANGED_MESSAGE };
    }
    if (chunk.status === "error") {
      return { status: "error", error: chunk.error };
    }
    if (revision === undefined) {
      if (chunk.size > maxBytes) {
        return { status: "unavailable", reason: tooLargeReason(maxBytes) };
      }
      revision = chunk.revision;
      onBegin();
      await sink.begin({ fileName: chunk.fileName, mimeType: chunk.mimeType, size: chunk.size });
    }
    const received = base64ByteLength(chunk.base64);
    // The revision includes the size, so an empty read before the end means the server misbehaved.
    // Stop rather than loop forever.
    if (received === 0 && offset < chunk.size) {
      return { status: "error", error: "Download stopped before the end of the file" };
    }
    await sink.append(chunk.base64);
    offset += received;
    onProgress?.(offset, chunk.size);
    if (offset >= chunk.size) {
      return { status: "complete" };
    }
  }
}

async function abortSink(sink: ChunkSink): Promise<void> {
  try {
    await sink.abort();
  } catch {
    // Cleanup is best effort and must not replace the failure that triggered it.
  }
}

function tooLargeReason(maxBytes: number): string {
  return `File is too large to download here (limit ${Math.round(maxBytes / MB)} MB)`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
