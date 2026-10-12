import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  button,
  captureObjectUrls,
  expect,
  explorerDock,
  lastBlobDigest,
  mainTabs,
  openApp,
  openCommandCenter,
  openWorkspace,
  state,
  test,
  visibleText,
} from "../support/web";

// The plugin in the daemon's bundled web UI, driven like a user would in a desktop browser.

const { allowed } = state.fixtures;
const NOTES_LINE = "- Ship the file explorer";

test("sidebar row opens the full-screen tree, and files open in the file screen", async ({
  page,
}) => {
  await openApp(page);
  await page.getByTestId("plugin-sidebar-file-explorer-browse").click();
  await page.waitForURL(/\/plugin\/file-explorer\/surface\/browse/);

  await expect(button(page, "Folder: QA. Switch folder")).toBeVisible();
  for (const name of ["docs", "src", ".env.example", "blob.bin", "notes.md", "swatch.png"]) {
    await expect(button(page, name)).toBeVisible();
  }
  await expect(page.getByText("escape-link.txt")).toHaveCount(0);

  await button(page, "src").click();
  await expect(button(page, "index.ts")).toBeVisible();

  await button(page, "Hide hidden files").click();
  await expect(button(page, ".env.example")).toHaveCount(0);

  await button(page, "Folder: QA. Switch folder").click();
  await expect(visibleText(page, "Manage allowed folders")).toBeVisible();
  await expect(visibleText(page, "Folder not found")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(visibleText(page, "Manage allowed folders")).toHaveCount(0);

  await button(page, "notes.md").click();
  await page.waitForURL(
    (url) =>
      url.pathname.endsWith("/plugin/file-explorer/surface/file") &&
      url.searchParams.get("param.root") === allowed &&
      url.searchParams.get("param.path") === "notes.md",
  );
  await expect(visibleText(page, NOTES_LINE)).toBeVisible();
  await expect(visibleText(page, path.join(allowed, "notes.md"))).toBeVisible();
});

test("Command Center opens the Folders tab, files open as tabs that survive a reload", async ({
  page,
}) => {
  await captureObjectUrls(page);
  await openWorkspace(page);

  const search = await openCommandCenter(page);
  await search.fill("allowed folders");
  await visibleText(page, "Open allowed folders in Explorer").click();

  const dock = explorerDock(page);
  await expect(button(dock, "Folders")).toBeVisible();
  await expect(button(dock, "Folder: QA. Switch folder")).toBeVisible();

  const tabs = mainTabs(page);
  await button(dock, "notes.md").click();
  await expect(button(tabs, "notes.md")).toBeVisible();
  await expect(visibleText(page, NOTES_LINE)).toBeVisible();

  await button(dock, "swatch.png").click();
  await expect(button(tabs, "swatch.png")).toBeVisible();
  await expect(visibleText(page, path.join(allowed, "swatch.png"))).toBeVisible();
  await expect(page.locator("img").filter({ visible: true })).not.toHaveCount(0);

  // Re-selecting an open file focuses its tab instead of adding another.
  await button(dock, "notes.md").click();
  await expect(button(tabs, "notes.md")).toHaveCount(1);
  await expect(visibleText(page, NOTES_LINE)).toBeVisible();

  await page.reload();
  await expect(button(tabs, "notes.md")).toBeVisible({ timeout: 60_000 });
  await expect(button(tabs, "swatch.png")).toBeVisible();
  await expect(visibleText(page, NOTES_LINE)).toBeVisible();
  await button(tabs, "swatch.png").click();
  await expect(visibleText(page, path.join(allowed, "swatch.png"))).toBeVisible();
  await expect(page.getByText("Plugin unavailable")).toHaveCount(0);

  // Binary files get a download instead of a preview. On web the bytes land in a Blob.
  await button(dock, "blob.bin").click();
  await expect(button(tabs, "blob.bin")).toBeVisible();
  await expect(visibleText(page, "Binary preview unavailable")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button")
    .filter({ hasText: /^Download$/, visible: true })
    .click();
  expect((await download).suggestedFilename()).toBe("blob.bin");
  await expect.poll(() => lastBlobDigest(page)).not.toBeNull();
  const expected = createHash("sha256")
    .update(await readFile(path.join(allowed, "blob.bin")))
    .digest("hex");
  expect(await lastBlobDigest(page)).toEqual({ size: 300 * 1024, sha256: expected });
});

test("settings screen adds, relabels, validates and removes allowed folders", async ({
  page,
  explorer,
}) => {
  await openApp(page);
  await page.goto(`${state.origin}/settings/hosts/${state.serverId}/plugins/file-explorer/folders`);
  await expect(button(page, "Add")).toBeVisible();
  await expect(visibleText(page, /Folder not found/)).toBeVisible();
  const remove = button(page, "Remove");
  await expect(remove).toHaveCount(2);

  const docs = path.join(allowed, "docs");
  await page.getByPlaceholder("~/notes", { exact: true }).fill(docs);
  await page.getByPlaceholder("Notes", { exact: true }).fill("Docs");
  await button(page, "Add").click();
  await expect(visibleText(page, "Docs")).toBeVisible();
  await expect(remove).toHaveCount(3);
  await expect
    .poll(async () => (await explorer.listFolders()).folders.map((folder) => folder.label))
    .toEqual(["QA", "missing", "Docs"]);

  // Relabel with real clicks: the label field's placeholder is the folder name.
  await button(page, "Edit").nth(2).click();
  const labelInput = page.getByPlaceholder("docs", { exact: true });
  await labelInput.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Documents");
  await button(page, "Save").click();
  await expect(visibleText(page, "Documents")).toBeVisible();
  await expect(button(page, "Save")).toHaveCount(0);
  await expect
    .poll(async () => (await explorer.listFolders()).folders.map((folder) => folder.label))
    .toEqual(["QA", "missing", "Documents"]);

  // Cancel keeps the saved label; an empty label falls back to the folder name.
  await button(page, "Edit").nth(2).click();
  await labelInput.fill("Ignored");
  await button(page, "Cancel").click();
  await expect(visibleText(page, "Documents")).toBeVisible();
  await button(page, "Edit").nth(2).click();
  await labelInput.fill("");
  await button(page, "Save").click();
  await expect(visibleText(page, "docs")).toBeVisible();
  await expect
    .poll(async () => (await explorer.listFolders()).folders.map((folder) => folder.label))
    .toEqual(["QA", "missing", "docs"]);

  await page.getByPlaceholder("~/notes", { exact: true }).fill("relative/path");
  await button(page, "Add").click();
  await expect(visibleText(page, /Use an absolute path/)).toBeVisible();
  await expect(remove).toHaveCount(3);

  await remove.nth(2).click();
  await expect(remove).toHaveCount(2);
  await expect(visibleText(page, "docs")).toHaveCount(0);
  await expect
    .poll(async () => (await explorer.listFolders()).folders.map((folder) => folder.label))
    .toEqual(["QA", "missing"]);
});
