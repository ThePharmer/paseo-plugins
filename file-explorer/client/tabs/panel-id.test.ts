import { describe, expect, it } from "vitest";
import { filePanelId } from "./panel-id";

// The app's contribution ID rule (packages/app/src/plugins/evaluate.ts).
const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;

describe("filePanelId", () => {
  it("is stable for the same file", () => {
    const file = { root: "/home/me/notes", path: "todo.md" };

    expect(filePanelId(file)).toBe(filePanelId({ ...file }));
    // Pinned so a change to the hash, which would orphan every persisted tab, fails here.
    // Cross-checked against an independent FNV-1a implementation.
    expect(filePanelId(file)).toBe("f-0y1zak30117y4j");
  });

  it("matches the contribution ID rule for unusual paths", () => {
    const files = [
      { root: "/", path: "a" },
      { root: "C:\\Users\\Me", path: "Docs/Résumé (final).PDF" },
      { root: "/srv", path: "emoji/🚀 launch.txt" },
      { root: "/srv", path: "UPPER/CASE.TXT" },
    ];

    for (const file of files) expect(filePanelId(file)).toMatch(CONTRIBUTION_ID);
  });

  it("differs for nearby paths and for the same path under another root", () => {
    const ids = new Set([
      filePanelId({ root: "/a", path: "file1.ts" }),
      filePanelId({ root: "/a", path: "file2.ts" }),
      filePanelId({ root: "/a", path: "file1.tsx" }),
      filePanelId({ root: "/a", path: "File1.ts" }),
      filePanelId({ root: "/b", path: "file1.ts" }),
      // The separator keeps root/path boundaries apart.
      filePanelId({ root: "/a/x", path: "y" }),
      filePanelId({ root: "/a", path: "x/y" }),
    ]);

    expect(ids.size).toBe(7);
  });

  it("has no collisions across many generated paths", () => {
    const ids = new Set<string>();
    const count = 20_000;
    for (let index = 0; index < count; index += 1) {
      ids.add(filePanelId({ root: "/repo", path: `src/module-${index}/index.ts` }));
    }

    expect(ids.size).toBe(count);
  });
});
