import { describe, expect, it } from "vitest";
import { isAcceptedFolderPath, relabelFolder, validateFolderDraft } from "./folder-draft";

describe("isAcceptedFolderPath", () => {
  it.each(["/", "/home/me/notes", "~", "~/notes", "C:\\Users\\me", "d:/data"])(
    "accepts %s",
    (path) => {
      expect(isAcceptedFolderPath(path)).toBe(true);
    },
  );

  it.each(["notes", "./notes", "../notes", "~me/notes", "C:", "\\\\server\\share", "~\\notes"])(
    "rejects %s",
    (path) => {
      expect(isAcceptedFolderPath(path)).toBe(false);
    },
  );
});

describe("validateFolderDraft", () => {
  it("trims the path and label and drops an empty label", () => {
    expect(validateFolderDraft({ path: "  ~/notes ", label: "  ", existing: [] })).toEqual({
      status: "valid",
      folder: { path: "~/notes" },
    });
    expect(validateFolderDraft({ path: "/srv", label: " Server ", existing: [] })).toEqual({
      status: "valid",
      folder: { path: "/srv", label: "Server" },
    });
  });

  it("explains an empty or relative path", () => {
    expect(validateFolderDraft({ path: " ", label: "", existing: [] })).toEqual({
      status: "invalid",
      error: "Enter a folder path",
    });
    expect(validateFolderDraft({ path: "notes", label: "", existing: [] })).toMatchObject({
      status: "invalid",
    });
  });

  it("rejects a folder that is already allowed, ignoring trailing separators", () => {
    const existing = [{ path: "/srv/data/" }, { path: "~" }];

    expect(validateFolderDraft({ path: "/srv/data", label: "", existing })).toEqual({
      status: "invalid",
      error: "This folder is already allowed",
    });
    expect(validateFolderDraft({ path: "~/", label: "", existing })).toMatchObject({
      status: "invalid",
    });
    expect(validateFolderDraft({ path: "/", label: "", existing })).toMatchObject({
      status: "valid",
    });
  });
});

describe("relabelFolder", () => {
  const folders = [{ path: "/srv" }, { path: "~/notes", label: "Notes" }];

  it("sets a trimmed label on the matching folder only", () => {
    expect(relabelFolder(folders, "/srv", "  Projects ")).toEqual([
      { path: "/srv", label: "Projects" },
      { path: "~/notes", label: "Notes" },
    ]);
  });

  it("drops the label when it is empty so the folder name shows again", () => {
    expect(relabelFolder(folders, "~/notes", "   ")).toEqual([
      { path: "/srv" },
      { path: "~/notes" },
    ]);
  });

  it("leaves the list unchanged when the folder is gone", () => {
    expect(relabelFolder(folders, "/missing", "X")).toEqual(folders);
  });
});
