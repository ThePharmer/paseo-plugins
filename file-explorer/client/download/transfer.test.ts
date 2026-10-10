import { describe, expect, it } from "vitest";
import { decodeBase64 } from "./base64";
import type { ReadFileChunk, SaveFileResult } from "./save-file";
import {
  DOWNLOAD_CHUNK_BYTES,
  FILE_CHANGED_MESSAGE,
  transferFile,
  type ChunkSink,
  type DownloadedFile,
} from "./transfer";
import { encodeBase64, sameBytes } from "./test-support";

type ChunkInput = Parameters<ReadFileChunk>[0];

interface RecordingSink extends ChunkSink {
  begun: DownloadedFile[];
  received: Uint8Array[];
  finished: number;
  aborted: number;
}

function recordingSink(result: SaveFileResult = { status: "saved" }): RecordingSink {
  const sink: RecordingSink = {
    begun: [],
    received: [],
    finished: 0,
    aborted: 0,
    async begin(file) {
      sink.begun.push(file);
    },
    async append(base64) {
      sink.received.push(decodeBase64(base64));
    },
    async finish() {
      sink.finished += 1;
      return result;
    },
    async abort() {
      sink.aborted += 1;
    },
  };
  return sink;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function patternBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 7) % 256);
}

/** A server that serves `bytes` like explorer.file.chunk, recording each request. */
function fakeServer(bytes: Uint8Array, revision = "rev-1") {
  const requests: ChunkInput[] = [];
  const readChunk: ReadFileChunk = async (input) => {
    requests.push(input);
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      return { status: "changed", revision };
    }
    const slice = bytes.subarray(input.offset, input.offset + input.length);
    return {
      status: "ok",
      base64: encodeBase64(slice),
      size: bytes.length,
      revision,
      fileName: "photo.png",
      mimeType: "image/png",
    };
  };
  return { readChunk, requests };
}

const BASE = { root: "/home/me/Documents", path: "photos/photo.png" };

describe("transferFile", () => {
  it("reads in chunk-sized steps pinned to the first revision and reports progress", async () => {
    const bytes = patternBytes(DOWNLOAD_CHUNK_BYTES * 2 + 5);
    const server = fakeServer(bytes);
    const sink = recordingSink();
    const progress: [number, number][] = [];

    const result = await transferFile({
      ...BASE,
      readChunk: server.readChunk,
      sink,
      maxBytes: bytes.length,
      onProgress: (received, total) => progress.push([received, total]),
    });

    expect(result).toEqual({ status: "saved" });
    expect(server.requests.map((request) => request.offset)).toEqual([
      0,
      DOWNLOAD_CHUNK_BYTES,
      DOWNLOAD_CHUNK_BYTES * 2,
    ]);
    expect(server.requests.map((request) => request.expectedRevision)).toEqual([
      undefined,
      "rev-1",
      "rev-1",
    ]);
    expect(server.requests.every((request) => request.length === DOWNLOAD_CHUNK_BYTES)).toBe(true);
    expect(sink.begun).toEqual([
      { fileName: "photo.png", mimeType: "image/png", size: bytes.length },
    ]);
    expect(sameBytes(concatBytes(sink.received), bytes)).toBe(true);
    expect(progress).toEqual([
      [DOWNLOAD_CHUNK_BYTES, bytes.length],
      [DOWNLOAD_CHUNK_BYTES * 2, bytes.length],
      [bytes.length, bytes.length],
    ]);
    expect(sink.finished).toBe(1);
  });

  it("uses a chunk size whose base64 never needs padding mid-file", () => {
    expect(DOWNLOAD_CHUNK_BYTES % 3).toBe(0);
  });

  it("handles an empty file with one read", async () => {
    const server = fakeServer(new Uint8Array(0));
    const sink = recordingSink();
    const result = await transferFile({ ...BASE, readChunk: server.readChunk, sink, maxBytes: 10 });
    expect(result).toEqual({ status: "saved" });
    expect(server.requests).toHaveLength(1);
    expect(sink.begun).toHaveLength(1);
    expect(sink.finished).toBe(1);
  });

  it("fails and aborts the sink when the file changes mid-download", async () => {
    const bytes = patternBytes(DOWNLOAD_CHUNK_BYTES + 1);
    const first = fakeServer(bytes, "rev-1");
    const second = fakeServer(bytes, "rev-2");
    let calls = 0;
    const readChunk: ReadFileChunk = (input) => {
      calls += 1;
      return calls === 1 ? first.readChunk(input) : second.readChunk(input);
    };
    const sink = recordingSink();

    const result = await transferFile({ ...BASE, readChunk, sink, maxBytes: bytes.length });

    expect(result).toEqual({ status: "error", error: FILE_CHANGED_MESSAGE });
    expect(sink.aborted).toBe(1);
    expect(sink.finished).toBe(0);
  });

  it("keeps the original failure when cleanup also fails", async () => {
    const bytes = patternBytes(DOWNLOAD_CHUNK_BYTES + 1);
    const server = fakeServer(bytes);
    let calls = 0;
    const readChunk: ReadFileChunk = (input) => {
      calls += 1;
      if (calls === 2) return Promise.resolve({ status: "changed", revision: "rev-2" });
      return server.readChunk(input);
    };
    const sink: ChunkSink = {
      ...recordingSink(),
      abort: () => Promise.reject(new Error("Disk full")),
    };
    const result = await transferFile({ ...BASE, readChunk, sink, maxBytes: bytes.length });
    expect(result).toEqual({ status: "error", error: FILE_CHANGED_MESSAGE });
  });

  it("passes server errors through without starting the sink", async () => {
    const sink = recordingSink();
    const result = await transferFile({
      ...BASE,
      readChunk: async () => ({ status: "error", error: "File not found" }),
      sink,
      maxBytes: 10,
    });
    expect(result).toEqual({ status: "error", error: "File not found" });
    expect(sink.begun).toHaveLength(0);
    expect(sink.aborted).toBe(0);
  });

  it("refuses files over the size limit after the first chunk", async () => {
    const bytes = patternBytes(64);
    const server = fakeServer(bytes);
    const sink = recordingSink();
    const result = await transferFile({
      ...BASE,
      readChunk: server.readChunk,
      sink,
      maxBytes: 63,
    });
    expect(result.status).toBe("unavailable");
    expect(server.requests).toHaveLength(1);
    expect(sink.begun).toHaveLength(0);
  });

  it("turns a rejected request or sink failure into an error result and aborts", async () => {
    const bytes = patternBytes(DOWNLOAD_CHUNK_BYTES + 1);
    const server = fakeServer(bytes);
    let calls = 0;
    const readChunk: ReadFileChunk = (input) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("Host disconnected"));
      return server.readChunk(input);
    };
    const sink = recordingSink();
    const result = await transferFile({ ...BASE, readChunk, sink, maxBytes: bytes.length });
    expect(result).toEqual({ status: "error", error: "Host disconnected" });
    expect(sink.aborted).toBe(1);
  });

  it("stops when the server returns no bytes before the end", async () => {
    const sink = recordingSink();
    let calls = 0;
    const result = await transferFile({
      ...BASE,
      readChunk: async () => {
        calls += 1;
        return {
          status: "ok",
          base64: "",
          size: 10,
          revision: "rev-1",
          fileName: "a.bin",
          mimeType: "application/octet-stream",
        };
      },
      sink,
      maxBytes: 10,
    });
    expect(result.status).toBe("error");
    expect(calls).toBe(1);
    expect(sink.aborted).toBe(1);
  });
});
