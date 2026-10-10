import { describe, expect, it } from "vitest";
import type { AllowedFolder, FileExplorerEntry } from "../../shared/rpc";
import { buildTreeListRows, type DirectoryLoadState, resolveActiveFolder } from "./rows";

function entry(path: string, kind: FileExplorerEntry["kind"]): FileExplorerEntry {
  return { name: path, path, kind, size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

describe("buildTreeListRows", () => {
  it("marks expanded folders, their loading state, and adds an error row for a failed listing", () => {
    const directoryStates = new Map<string, DirectoryLoadState>([
      ["loading", { status: "loading" }],
      ["broken", { status: "error", error: "Permission denied" }],
      ["collapsed", { status: "error", error: "stale" }],
    ]);

    const rows = buildTreeListRows({
      rows: [
        { entry: entry("loading", "directory"), depth: 0 },
        { entry: entry("broken", "directory"), depth: 0 },
        { entry: entry("collapsed", "directory"), depth: 0 },
        { entry: entry("file.txt", "file"), depth: 0 },
      ],
      expandedPaths: new Set([".", "loading", "broken"]),
      directoryStates,
    });

    expect(
      rows.map((row) =>
        row.type === "entry"
          ? [row.row.entry.path, row.expanded, row.loading]
          : ["error", row.path, row.depth, row.error],
      ),
    ).toEqual([
      ["loading", true, true],
      ["broken", true, false],
      ["error", "broken", 1, "Permission denied"],
      // A collapsed folder never shows its listing state.
      ["collapsed", false, false],
      ["file.txt", false, false],
    ]);
  });
});

describe("resolveActiveFolder", () => {
  const folders: AllowedFolder[] = [
    { root: "/gone", label: "Gone", status: "missing" },
    { root: "/a", label: "A", status: "ready" },
    { root: "/b", label: "B", status: "ready" },
  ];

  it("keeps the picked folder, even when it is not ready", () => {
    expect(resolveActiveFolder(folders, "/b")?.root).toBe("/b");
    expect(resolveActiveFolder(folders, "/gone")?.root).toBe("/gone");
  });

  it("falls back to the first ready folder when nothing or a removed folder was picked", () => {
    expect(resolveActiveFolder(folders, null)?.root).toBe("/a");
    expect(resolveActiveFolder(folders, "/removed")?.root).toBe("/a");
  });

  it("shows the first folder when none is ready, and nothing when none is configured", () => {
    expect(resolveActiveFolder([folders[0]], null)?.root).toBe("/gone");
    expect(resolveActiveFolder([], null)).toBeNull();
  });
});
