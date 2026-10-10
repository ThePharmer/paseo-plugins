// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/file-explorer/visibility.ts (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: plugin types.

import type { FileExplorerEntry } from "../../shared/rpc";

export function isHiddenExplorerPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

export function filterVisibleExplorerEntries(
  entries: FileExplorerEntry[],
  showHiddenFiles: boolean,
): FileExplorerEntry[] {
  if (showHiddenFiles) {
    return entries;
  }
  return entries.filter((entry) => !entry.name.startsWith("."));
}
