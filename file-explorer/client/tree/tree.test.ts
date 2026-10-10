import { describe, expect, it } from "vitest";
import type { FileExplorerDirectory, FileExplorerEntry } from "../../shared/rpc";
import { flattenExplorerTree, nextSortOption, reachableExpandedPaths } from "./tree";
import { filterVisibleExplorerEntries, isHiddenExplorerPath } from "./visibility";

function file(path: string, size = 0, modifiedAt = "2026-01-01T00:00:00.000Z"): FileExplorerEntry {
  return { name: path.split("/").pop() ?? path, path, kind: "file", size, modifiedAt };
}

function folder(path: string, modifiedAt = "2026-01-01T00:00:00.000Z"): FileExplorerEntry {
  return { name: path.split("/").pop() ?? path, path, kind: "directory", size: 0, modifiedAt };
}

function directories(
  listings: Record<string, FileExplorerEntry[]>,
): Map<string, FileExplorerDirectory> {
  return new Map(Object.entries(listings).map(([path, entries]) => [path, { path, entries }]));
}

function paths(rows: { entry: FileExplorerEntry; depth: number }[]): string[] {
  return rows.map((row) => `${"  ".repeat(row.depth)}${row.entry.path}`);
}

describe("flattenExplorerTree", () => {
  it("lists folders before files, each sorted by name", () => {
    const rows = flattenExplorerTree({
      directories: directories({
        ".": [file("b.ts"), folder("src"), file("a.ts"), folder("docs")],
      }),
      expandedPaths: new Set(["."]),
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(paths(rows)).toEqual(["docs", "src", "a.ts", "b.ts"]);
  });

  it("sorts by newest first and by largest first, keeping folders on top", () => {
    const listing = directories({
      ".": [
        file("old.ts", 300, "2026-01-01T00:00:00.000Z"),
        file("new.ts", 100, "2026-03-01T00:00:00.000Z"),
        folder("lib", "2025-01-01T00:00:00.000Z"),
      ],
    });
    const input = { directories: listing, expandedPaths: new Set(["."]), showHiddenFiles: true };

    expect(paths(flattenExplorerTree({ ...input, sortOption: "modified" }))).toEqual([
      "lib",
      "new.ts",
      "old.ts",
    ]);
    expect(paths(flattenExplorerTree({ ...input, sortOption: "size" }))).toEqual([
      "lib",
      "old.ts",
      "new.ts",
    ]);
  });

  it("nests the children of expanded, loaded folders under their parent", () => {
    const rows = flattenExplorerTree({
      directories: directories({
        ".": [folder("src"), folder("test"), file("README.md")],
        src: [file("src/index.ts"), folder("src/lib")],
        "src/lib": [file("src/lib/util.ts")],
        test: [file("test/a.test.ts")],
      }),
      // test is loaded but collapsed; src/lib is expanded and loaded.
      expandedPaths: new Set([".", "src", "src/lib"]),
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(paths(rows)).toEqual([
      "src",
      "  src/lib",
      "    src/lib/util.ts",
      "  src/index.ts",
      "test",
      "README.md",
    ]);
  });

  it("hides dotfiles unless hidden files are shown", () => {
    const listing = directories({ ".": [file(".env"), folder(".git"), file("index.ts")] });

    const hidden = flattenExplorerTree({
      directories: listing,
      expandedPaths: new Set(["."]),
      sortOption: "name",
      showHiddenFiles: false,
    });
    const shown = flattenExplorerTree({
      directories: listing,
      expandedPaths: new Set(["."]),
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(paths(hidden)).toEqual(["index.ts"]);
    expect(paths(shown)).toEqual([".git", ".env", "index.ts"]);
  });

  it("returns no rows until the root listing is loaded", () => {
    const rows = flattenExplorerTree({
      directories: directories({ src: [file("src/index.ts")] }),
      expandedPaths: new Set([".", "src"]),
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(rows).toEqual([]);
  });
});

describe("reachableExpandedPaths", () => {
  it("loads the root and expanded folders whose ancestors are all expanded", () => {
    const expanded = new Set([".", "src", "src/lib", "docs/api", "test/unit"]);

    // docs and test are collapsed, so their expanded children are not loaded.
    expect(reachableExpandedPaths(expanded, true)).toEqual([".", "src", "src/lib"]);
  });

  it("skips hidden folders and everything under them while hidden files are hidden", () => {
    const expanded = new Set([".", ".github", ".github/workflows", "src"]);

    expect(reachableExpandedPaths(expanded, false)).toEqual([".", "src"]);
    expect(reachableExpandedPaths(expanded, true)).toEqual([
      ".",
      ".github",
      ".github/workflows",
      "src",
    ]);
  });

  it("always includes the root, even when nothing is expanded", () => {
    expect(reachableExpandedPaths(new Set(), false)).toEqual(["."]);
  });
});

describe("visibility", () => {
  it("treats any dot-prefixed segment as hidden, but not . and ..", () => {
    expect(isHiddenExplorerPath("src/.cache/x")).toBe(true);
    expect(isHiddenExplorerPath(".")).toBe(false);
    expect(isHiddenExplorerPath("../src")).toBe(false);
    expect(isHiddenExplorerPath("src/index.ts")).toBe(false);
  });

  it("filters entries by name", () => {
    expect(filterVisibleExplorerEntries([file(".env"), file("a")], false)).toEqual([file("a")]);
  });
});

describe("nextSortOption", () => {
  it("cycles name, modified, size like the core sort trigger", () => {
    expect(nextSortOption("name")).toBe("modified");
    expect(nextSortOption("modified")).toBe("size");
    expect(nextSortOption("size")).toBe("name");
  });
});
