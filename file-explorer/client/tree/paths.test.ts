import { describe, expect, it } from "vitest";
import { buildAbsoluteExplorerPath, explorerBasename } from "./paths";

describe("buildAbsoluteExplorerPath", () => {
  it("joins the root and the relative path", () => {
    expect(buildAbsoluteExplorerPath({ root: "/home/me/notes/", entryPath: "a/b.md" })).toBe(
      "/home/me/notes/a/b.md",
    );
  });

  it("returns the root for the root directory", () => {
    expect(buildAbsoluteExplorerPath({ root: "/home/me/notes", entryPath: "." })).toBe(
      "/home/me/notes",
    );
  });

  it("keeps Windows separators for a Windows root", () => {
    expect(buildAbsoluteExplorerPath({ root: "C:\\Users\\me", entryPath: "docs/a.txt" })).toBe(
      "C:\\Users\\me\\docs\\a.txt",
    );
  });
});

describe("explorerBasename", () => {
  it("returns the last path segment", () => {
    expect(explorerBasename("src/lib/util.ts")).toBe("util.ts");
    expect(explorerBasename("README.md")).toBe("README.md");
  });
});
