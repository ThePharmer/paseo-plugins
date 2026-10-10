import { describe, expect, it } from "vitest";
import { absolutePathOf, fileNameOf, formatFileSize } from "./path";

describe("fileNameOf", () => {
  it("returns the last segment", () => {
    expect(fileNameOf("docs/guide/intro.md")).toBe("intro.md");
    expect(fileNameOf("README")).toBe("README");
    expect(fileNameOf("docs/")).toBe("docs");
  });
});

describe("absolutePathOf", () => {
  it("joins POSIX roots", () => {
    expect(absolutePathOf("/home/me/Documents", "notes/today.md")).toBe(
      "/home/me/Documents/notes/today.md",
    );
    expect(absolutePathOf("/home/me/Documents/", "/notes//today.md")).toBe(
      "/home/me/Documents/notes/today.md",
    );
    expect(absolutePathOf("/", "etc/hosts")).toBe("/etc/hosts");
    expect(absolutePathOf("/home/me", "")).toBe("/home/me");
  });

  it("keeps Windows separators", () => {
    expect(absolutePathOf("C:\\Users\\me", "notes/today.md")).toBe(
      "C:\\Users\\me\\notes\\today.md",
    );
    expect(absolutePathOf("C:\\", "a.txt")).toBe("C:\\a.txt");
  });
});

describe("formatFileSize", () => {
  it("uses core's units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
