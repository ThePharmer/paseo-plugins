import { describe, expect, it } from "vitest";
import { FILE_TAB_ICONS, fileTabIcon } from "./tab-icon";

describe("fileTabIcon", () => {
  it.each([
    ["index.ts", "FileCode"],
    ["App.TSX", "FileCode"],
    ["deploy.sh", "FileTerminal"],
    ["package.json", "FileJson"],
    ["README.md", "FileText"],
    ["photo.JPEG", "FileImage"],
    ["backup.tar.gz", "FileArchive"],
    ["report.xlsx", "FileSpreadsheet"],
    ["clip.mp4", "FileVideo"],
    ["song.flac", "FileAudio"],
    ["config.yaml", "FileCog"],
    [".env", "FileCog"],
    ["id_rsa.pub", "FileKey"],
    ["Cargo.lock", "FileLock"],
    ["Dockerfile", "FileCode"],
    ["LICENSE", "FileText"],
  ])("maps %s to %s", (fileName, icon) => {
    expect(fileTabIcon(fileName)).toBe(icon);
  });

  it("falls back to the generic icon for unknown, missing and trailing-dot extensions", () => {
    expect(fileTabIcon("data.unknownext")).toBe("File");
    expect(fileTabIcon("notes")).toBe("File");
    expect(fileTabIcon("weird.")).toBe("File");
    expect(fileTabIcon("x.constructor")).toBe("File");
  });

  it("only returns names from the verified icon list", () => {
    const samples = ["a.ts", "a.json", "a.png", "a.zip", "a.csv", "a.mp3", "a.toml", "a.zzz"];
    for (const sample of samples) {
      expect(FILE_TAB_ICONS).toContain(fileTabIcon(sample));
    }
  });
});
