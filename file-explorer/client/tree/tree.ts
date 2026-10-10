// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/file-explorer/tree.ts (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: plugin types; the restore helpers are replaced by reachableExpandedPaths because each
// directory is its own React Query entry here; added the sort cycle from file-explorer-pane.tsx.

import type { FileExplorerDirectory, FileExplorerEntry } from "../../shared/rpc";
import { filterVisibleExplorerEntries, isHiddenExplorerPath } from "./visibility";

export const ROOT_DIRECTORY_PATH = ".";

export type SortOption = "name" | "modified" | "size";

const SORT_OPTIONS: readonly SortOption[] = ["name", "modified", "size"];

export const SORT_LABELS: Readonly<Record<SortOption, string>> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
};

export interface ExplorerTreeRow {
  entry: FileExplorerEntry;
  depth: number;
}

interface FlattenExplorerTreeInput {
  directories: ReadonlyMap<string, FileExplorerDirectory>;
  expandedPaths: ReadonlySet<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
}

interface SetExpandedDirectoryPathInput {
  currentExpandedPaths: readonly string[];
  directoryPath: string;
  expanded: boolean;
}

export function flattenExplorerTree({
  directories,
  expandedPaths,
  sortOption,
  showHiddenFiles,
}: FlattenExplorerTreeInput): ExplorerTreeRow[] {
  const root = directories.get(ROOT_DIRECTORY_PATH);
  if (!root) {
    return [];
  }

  const rows: ExplorerTreeRow[] = [];
  // An explicit stack keeps very deep trees off the call stack.
  const pending = rowsForDirectory(root, 0, sortOption, showHiddenFiles).toReversed();

  while (pending.length > 0) {
    const row = pending.pop();
    if (!row) {
      break;
    }
    rows.push(row);

    const entry = row.entry;
    if (entry.kind !== "directory" || !expandedPaths.has(entry.path)) {
      continue;
    }
    const childDirectory = directories.get(entry.path);
    if (!childDirectory) {
      continue;
    }
    const childRows = rowsForDirectory(childDirectory, row.depth + 1, sortOption, showHiddenFiles);
    for (let index = childRows.length - 1; index >= 0; index -= 1) {
      pending.push(childRows[index]);
    }
  }

  return rows;
}

export function setExpandedDirectoryPath({
  currentExpandedPaths,
  directoryPath,
  expanded,
}: SetExpandedDirectoryPathInput): string[] {
  const nextPaths = new Set(currentExpandedPaths);
  if (expanded) {
    nextPaths.add(directoryPath);
  } else {
    nextPaths.delete(directoryPath);
  }
  return Array.from(nextPaths);
}

/**
 * The directories whose listings the tree needs: the root plus every expanded directory whose
 * ancestors are all expanded, skipping hidden ones while hidden files are hidden. Collapsing a
 * folder keeps its descendants' expansion, as core does, but stops loading them.
 */
export function reachableExpandedPaths(
  expandedPaths: ReadonlySet<string>,
  showHiddenFiles: boolean,
): string[] {
  const reachable = [ROOT_DIRECTORY_PATH];
  for (const path of expandedPaths) {
    if (path === ROOT_DIRECTORY_PATH) continue;
    if (!showHiddenFiles && isHiddenExplorerPath(path)) continue;
    if (ancestorsOf(path).every((ancestor) => expandedPaths.has(ancestor))) {
      reachable.push(path);
    }
  }
  return reachable;
}

export function nextSortOption(current: SortOption): SortOption {
  const index = SORT_OPTIONS.indexOf(current);
  return SORT_OPTIONS[(index + 1) % SORT_OPTIONS.length];
}

function ancestorsOf(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function rowsForDirectory(
  directory: FileExplorerDirectory,
  depth: number,
  sortOption: SortOption,
  showHiddenFiles: boolean,
): ExplorerTreeRow[] {
  const visibleEntries = filterVisibleExplorerEntries(directory.entries, showHiddenFiles);
  const sortedEntries = sortExplorerEntries(visibleEntries, sortOption);
  return sortedEntries.map((entry) => ({ entry, depth }));
}

function sortExplorerEntries(
  entries: FileExplorerEntry[],
  sortOption: SortOption,
): FileExplorerEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    switch (sortOption) {
      case "name":
        return a.name.localeCompare(b.name);
      case "modified":
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      case "size":
        return b.size - a.size;
    }
  });
  return sorted;
}
