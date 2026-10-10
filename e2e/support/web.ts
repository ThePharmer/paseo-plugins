import { expect, type Locator, type Page, test as base } from "@playwright/test";
import { connectExplorerClient, type ExplorerClient } from "./client";
import { defaultFolders, type E2EState, readState } from "./state";

// Browser fixtures for the daemon's bundled web UI. The UI is served from the daemon's own
// origin, so it connects to that host without the Direct connection dialog.

interface WebFixtures {
  explorer: ExplorerClient;
  diagnostics: string[];
}

export const state: E2EState = readState();

export const test = base.extend<WebFixtures>({
  // Auto, so every test starts from the seeded folder list and no remembered file tabs. The
  // `page` dependency only orders it; Playwright fixtures must destructure their first argument.
  // The second argument is Playwright's `use`, renamed so React hook lint rules leave it alone.
  explorer: [
    async ({ page: _page }, provide) => {
      const client = await connectExplorerClient(state.port, state.pluginId);
      await client.writeAllowedFolders(defaultFolders(state));
      await client.clearOpenFiles();
      await provide(client);
      await client.writeAllowedFolders(defaultFolders(state));
      await client.close();
    },
    { auto: true },
  ],
  diagnostics: [
    async ({ page }, provide, testInfo) => {
      const lines: string[] = [];
      page.on("pageerror", (error) => lines.push(`[pageerror] ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") lines.push(`[console.error] ${message.text()}`);
      });
      await provide(lines);
      if (testInfo.status !== testInfo.expectedStatus && lines.length > 0) {
        await testInfo.attach("browser-errors.txt", {
          body: lines.join("\n"),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Loads the web UI and waits until the plugin's sidebar row has rendered. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(state.origin);
  // The first load fetches the bundle, connects, and loads the plugin's client code.
  await expect(page.getByTestId("plugin-sidebar-file-explorer-browse")).toBeVisible({
    timeout: 60_000,
  });
}

/** Opens the fixture workspace from the sidebar, the way a user gets there. */
export async function openWorkspace(page: Page): Promise<void> {
  await openApp(page);
  await page.getByRole("button", { name: state.workspaceTitle, exact: true }).click();
  await page.waitForURL(new RegExp(`/workspace/${state.workspaceId}`));
  await expect(mainTabs(page)).toBeVisible();
}

/** Tab strip of the workspace's main pane. The Explorer dock has its own strip. */
export function mainTabs(page: Page): Locator {
  return page.getByTestId("workspace-pane-main").getByTestId("workspace-tabs-row");
}

export function explorerDock(page: Page): Locator {
  return page.getByTestId("workspace-explorer-sidebar");
}

export async function openCommandCenter(page: Page): Promise<Locator> {
  const search = page.getByPlaceholder(/Search commands/);
  // The shortcut is ignored until the workspace screen has focus handlers attached.
  await expect(async () => {
    if (!(await search.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(search).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return search;
}

/** A visible element with exactly this text, ignoring copies in hidden, still-mounted panels. */
export function visibleText(scope: Page | Locator, text: string | RegExp): Locator {
  return scope.getByText(text, { exact: typeof text === "string" }).filter({ visible: true });
}

export function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true }).filter({ visible: true });
}

declare global {
  interface Window {
    __e2eBlobs?: Blob[];
  }
}

/** Records every Blob handed to URL.createObjectURL, which is how the plugin saves on web. */
export async function captureObjectUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    window.__e2eBlobs = [];
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) window.__e2eBlobs?.push(object);
      return original(object);
    };
  });
}

export async function lastBlobDigest(page: Page): Promise<{ size: number; sha256: string } | null> {
  return page.evaluate(async () => {
    const blobs = window.__e2eBlobs ?? [];
    const blob = blobs.at(-1);
    if (!blob) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
    return { size: blob.size, sha256: hex.join("") };
  });
}
