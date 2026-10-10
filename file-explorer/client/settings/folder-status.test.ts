import { describe, expect, it } from "vitest";
import type { AllowedFolder } from "../../shared/rpc";
import { matchFolderStatuses } from "./folder-status";

function folder(root: string, status: AllowedFolder["status"] = "ready"): AllowedFolder {
  return { root, label: root, status };
}

describe("matchFolderStatuses", () => {
  it("pairs absolute paths exactly, ignoring trailing separators", () => {
    const folders = [folder("/srv/data"), folder("/srv/gone", "missing")];

    const matches = matchFolderStatuses([{ path: "/srv/gone/" }, { path: "/srv/data" }], folders);

    expect(matches.map((match) => match?.status)).toEqual(["missing", "ready"]);
  });

  it("pairs ~/ paths by suffix and a bare ~ with the one remaining root", () => {
    const folders = [folder("/home/me"), folder("/home/me/notes", "not-directory")];

    const matches = matchFolderStatuses([{ path: "~" }, { path: "~/notes" }], folders);

    expect(matches.map((match) => match?.root)).toEqual(["/home/me", "/home/me/notes"]);
  });

  it("matches Windows roots across separators and drive letter case", () => {
    const matches = matchFolderStatuses([{ path: "c:/Users/me/" }], [folder("C:\\Users\\me")]);

    expect(matches[0]?.root).toBe("C:\\Users\\me");
  });

  it("leaves a setting the daemon deduped into another without a status", () => {
    const matches = matchFolderStatuses(
      [{ path: "/home/me/notes" }, { path: "~/notes" }],
      [folder("/home/me/notes")],
    );

    expect(matches.map((match) => match?.root ?? null)).toEqual(["/home/me/notes", null]);
  });
});
