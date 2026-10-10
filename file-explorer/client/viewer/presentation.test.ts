import { describe, expect, it } from "vitest";
import type { FileExplorerFile } from "../../shared/rpc";
import {
  countLines,
  resolveViewerContent,
  selectSourcePresentation,
  SOURCE_PRESENTATION_BUDGET,
  SVG_UNSUPPORTED_NOTE,
  TOO_LARGE_ERROR,
  viewerContentSize,
} from "./presentation";

function file(overrides: Partial<FileExplorerFile>): FileExplorerFile {
  return {
    path: "notes.md",
    kind: "text",
    encoding: "utf-8",
    content: "# Notes",
    mimeType: "text/markdown",
    size: 7,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    revision: "rev-1",
    ...overrides,
  };
}

function done(value: FileExplorerFile) {
  return { status: "done" as const, output: { status: "ok" as const, file: value } };
}

describe("selectSourcePresentation", () => {
  it("keeps threshold edges predictable", () => {
    const { highlighted, plain } = SOURCE_PRESENTATION_BUDGET;
    expect(selectSourcePresentation(highlighted)).toBe("highlighted");
    expect(selectSourcePresentation(highlighted + 1)).toBe("plain");
    expect(selectSourcePresentation(plain)).toBe("plain");
    expect(selectSourcePresentation(plain + 1)).toBe("unsupported");
  });
});

describe("resolveViewerContent", () => {
  it("maps pending and failed reads", () => {
    expect(resolveViewerContent({ status: "pending" }, "ios")).toEqual({ kind: "loading" });
    expect(resolveViewerContent({ status: "failed", message: "Offline" }, "web")).toEqual({
      kind: "error",
      message: "Offline",
    });
  });

  it("recognizes the server's too-large refusal and other errors", () => {
    const tooLarge = { status: "error" as const, error: TOO_LARGE_ERROR };
    expect(resolveViewerContent({ status: "done", output: tooLarge }, "web")).toEqual({
      kind: "too-large",
      size: null,
    });
    const missing = { status: "error" as const, error: "File not found" };
    expect(resolveViewerContent({ status: "done", output: missing }, "web")).toEqual({
      kind: "error",
      message: "File not found",
    });
  });

  it("picks highlighted or plain text by size", () => {
    expect(resolveViewerContent(done(file({})), "android")).toEqual({
      kind: "text",
      content: "# Notes",
      size: 7,
      presentation: "highlighted",
    });
    const big = SOURCE_PRESENTATION_BUDGET.highlighted + 1;
    expect(resolveViewerContent(done(file({ size: big })), "web")).toMatchObject({
      kind: "text",
      presentation: "plain",
    });
    const huge = SOURCE_PRESENTATION_BUDGET.plain + 1;
    expect(resolveViewerContent(done(file({ size: huge })), "web")).toEqual({
      kind: "too-large",
      size: huge,
    });
  });

  it("builds a data URI for images", () => {
    const png = file({ kind: "image", encoding: "base64", content: "iVBO", mimeType: "image/png" });
    expect(resolveViewerContent(done(png), "ios")).toEqual({
      kind: "image",
      uri: "data:image/png;base64,iVBO",
      size: 7,
    });
  });

  it("renders SVG only on web", () => {
    const svg = file({
      kind: "image",
      encoding: "base64",
      content: "PHN2",
      mimeType: "image/svg+xml",
    });
    expect(resolveViewerContent(done(svg), "web")).toMatchObject({ kind: "image" });
    expect(resolveViewerContent(done(svg), "android")).toEqual({
      kind: "binary",
      size: 7,
      note: SVG_UNSUPPORTED_NOTE,
    });
  });

  it("treats binary files and images without content as binary", () => {
    const binary = file({ kind: "binary", encoding: "none", content: undefined, size: 2048 });
    expect(resolveViewerContent(done(binary), "web")).toEqual({
      kind: "binary",
      size: 2048,
      note: null,
    });
    const emptyImage = file({ kind: "image", encoding: "base64", content: undefined });
    expect(resolveViewerContent(done(emptyImage), "web")).toMatchObject({ kind: "binary" });
  });
});

describe("countLines", () => {
  it("matches split-on-newline counting", () => {
    for (const text of ["", "one", "one\n", "a\nb\nc", "\n\n", "crlf\r\nline"]) {
      expect(countLines(text)).toBe(text.split("\n").length);
    }
  });
});

describe("viewerContentSize", () => {
  it("reports a size only when the read produced one", () => {
    expect(viewerContentSize({ kind: "loading" })).toBeNull();
    expect(viewerContentSize({ kind: "too-large", size: null })).toBeNull();
    expect(viewerContentSize({ kind: "binary", size: 5, note: null })).toBe(5);
  });
});
