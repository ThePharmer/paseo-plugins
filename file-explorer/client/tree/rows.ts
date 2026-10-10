import type { AllowedFolder } from "../../shared/rpc";
import type { ExplorerTreeRow } from "./tree";

/** What a directory's listing query looks like to the row list. */
export type DirectoryLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: string };

export type TreeListRow =
  | { type: "entry"; row: ExplorerTreeRow; expanded: boolean; loading: boolean }
  | { type: "error"; path: string; depth: number; error: string };

interface BuildTreeListRowsInput {
  rows: readonly ExplorerTreeRow[];
  expandedPaths: ReadonlySet<string>;
  directoryStates: ReadonlyMap<string, DirectoryLoadState>;
}

/**
 * Adds per-row expansion and loading flags, and an error row under an expanded folder whose
 * listing failed, so one unreadable folder does not take the whole tree down.
 */
export function buildTreeListRows({
  rows,
  expandedPaths,
  directoryStates,
}: BuildTreeListRowsInput): TreeListRow[] {
  const listRows: TreeListRow[] = [];
  for (const row of rows) {
    const { entry } = row;
    const expanded = entry.kind === "directory" && expandedPaths.has(entry.path);
    const state = expanded ? directoryStates.get(entry.path) : undefined;
    listRows.push({ type: "entry", row, expanded, loading: state?.status === "loading" });
    if (state?.status === "error") {
      listRows.push({ type: "error", path: entry.path, depth: row.depth + 1, error: state.error });
    }
  }
  return listRows;
}

export function treeListRowKey(row: TreeListRow): string {
  return row.type === "entry" ? row.row.entry.path : `error:${row.path}`;
}

/**
 * The folder the tree shows: the one the user picked while it is still configured, else the
 * first ready folder, else the first configured one so its status can be shown.
 */
export function resolveActiveFolder(
  folders: readonly AllowedFolder[],
  pickedRoot: string | null,
): AllowedFolder | null {
  const picked = folders.find((folder) => folder.root === pickedRoot);
  if (picked) return picked;
  return folders.find((folder) => folder.status === "ready") ?? folders[0] ?? null;
}
