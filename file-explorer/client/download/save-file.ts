import { Share } from "react-native";
import type { z } from "zod";
import type { readFileChunkRpc } from "../../shared/rpc";
import { createBrowserSink, hasDocument } from "./browser";
import {
  createNativeSink,
  readExpoModules,
  resolveNativeSaveMethod,
  type DataUrlShareOutcome,
} from "./native";
import { DOWNLOAD_SIZE_LIMITS, transferFile } from "./transfer";

// Interface contract shared by the tree/tabs code and the download code. The download agent
// replaces the bodies; the exported names and types stay as they are.

export type ReadFileChunk = (
  input: z.input<(typeof readFileChunkRpc)["input"]>,
) => Promise<z.output<(typeof readFileChunkRpc)["output"]>>;

export type ClientPlatform = "ios" | "android" | "web";

export type SaveFileResult =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: string };

export interface SaveFileInput {
  root: string;
  path: string;
  readChunk: ReadFileChunk;
  platform: ClientPlatform;
  onProgress?: (received: number, total: number) => void;
}

/** Whether a Download/Share action should be offered on this client at all. */
export function canSaveFiles(platform: ClientPlatform): boolean {
  if (platform === "web") return hasDocument();
  return resolveNativeSaveMethod(platform, readExpoModules()) !== null;
}

/**
 * Downloads a file in chunks and hands it to the user: a browser download on web and desktop,
 * the share sheet on iOS and Android. Never throws; every failure is a result.
 */
export async function saveFile(input: SaveFileInput): Promise<SaveFileResult> {
  const { root, path, readChunk, platform, onProgress } = input;
  if (platform === "web") {
    if (!hasDocument()) return { status: "unavailable", reason: UNAVAILABLE_REASON };
    const sink = createBrowserSink();
    return transferFile({
      root,
      path,
      readChunk,
      sink,
      maxBytes: DOWNLOAD_SIZE_LIMITS.web,
      onProgress,
    });
  }
  const method = resolveNativeSaveMethod(platform, readExpoModules());
  if (!method) return { status: "unavailable", reason: UNAVAILABLE_REASON };
  const sink = createNativeSink(method, {
    shareDataUrl,
    createId,
    sharedDirectories,
  });
  return transferFile({
    root,
    path,
    readChunk,
    sink,
    maxBytes: DOWNLOAD_SIZE_LIMITS.native,
    onProgress,
  });
}

const UNAVAILABLE_REASON = "Downloads are not available in this version of the Paseo app";

// Earlier shares' cache folders, deleted at the start of the next native save.
const sharedDirectories: string[] = [];

async function shareDataUrl(input: { url: string; title: string }): Promise<DataUrlShareOutcome> {
  const result = await Share.share({ url: input.url, title: input.title });
  return result.action === Share.dismissedAction ? "dismissed" : "shared";
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
