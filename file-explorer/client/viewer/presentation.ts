// Partly copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/file-pane/source/presentation.ts (Apache-2.0, Copyright (c) 2025-present
// Mohamed Boudra).
// Modified: one budget for every platform, plus the viewer's content classification.

import type { RpcOutput } from "@getpaseo/plugin";
import type { readFileRpc } from "../../shared/rpc";

// Core's native budgets. They describe the FlatList renderer, which highlights the whole file up
// front, so they apply on web too; core's larger web budgets assume CodeMirror's lazy viewport.
export const SOURCE_PRESENTATION_BUDGET = {
  highlighted: 1024 * 1024,
  plain: 10 * 1024 * 1024,
} as const;

// The exact message explorer.file.read returns above its 10 MB cap (server/handlers.ts).
export const TOO_LARGE_ERROR = "File is too large to display";

export type SourcePresentation = "highlighted" | "plain" | "unsupported";

export function selectSourcePresentation(size: number): SourcePresentation {
  if (size <= SOURCE_PRESENTATION_BUDGET.highlighted) return "highlighted";
  if (size <= SOURCE_PRESENTATION_BUDGET.plain) return "plain";
  return "unsupported";
}

export type ReadFileOutput = RpcOutput<typeof readFileRpc>;

export type ReadState =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "done"; output: ReadFileOutput };

export type ViewerContent =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "too-large"; size: number | null }
  | { kind: "text"; content: string; size: number; presentation: "highlighted" | "plain" }
  | { kind: "image"; uri: string; size: number }
  | { kind: "binary"; size: number; note: string | null };

export const SVG_UNSUPPORTED_NOTE = "SVG previews are not available on this device";

/** What the viewer body shows for a read, on a given platform. */
export function resolveViewerContent(
  read: ReadState,
  platform: "ios" | "android" | "web",
): ViewerContent {
  if (read.status === "pending") return { kind: "loading" };
  if (read.status === "failed") return { kind: "error", message: read.message };
  const output = read.output;
  if (output.status === "error") {
    if (output.error === TOO_LARGE_ERROR) return { kind: "too-large", size: null };
    return { kind: "error", message: output.error };
  }
  const file = output.file;
  if (file.kind === "text") {
    const presentation = selectSourcePresentation(file.size);
    if (presentation === "unsupported") return { kind: "too-large", size: file.size };
    return { kind: "text", content: file.content ?? "", size: file.size, presentation };
  }
  if (file.kind === "image" && file.content !== undefined && file.mimeType !== undefined) {
    // React Native's Image renders SVG only in browsers.
    if (file.mimeType === "image/svg+xml" && platform !== "web") {
      return { kind: "binary", size: file.size, note: SVG_UNSUPPORTED_NOTE };
    }
    return { kind: "image", uri: `data:${file.mimeType};base64,${file.content}`, size: file.size };
  }
  return { kind: "binary", size: file.size, note: null };
}

/** Line count as core's file bar computes it (split on "\n"), without allocating the lines. */
export function countLines(content: string): number {
  let count = 1;
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    count += 1;
  }
  return count;
}

/** The file size the header shows, when the read produced one. */
export function viewerContentSize(content: ViewerContent): number | null {
  switch (content.kind) {
    case "loading":
    case "error":
      return null;
    case "too-large":
      return content.size;
    case "text":
    case "image":
    case "binary":
      return content.size;
  }
}
