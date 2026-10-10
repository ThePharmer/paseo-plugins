import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectExplorerClient, PLUGIN_ID } from "./client";
import { createWorkspace, installPlugin, startIsolatedDaemon } from "./daemon";
import { seedFixtures } from "./fixtures";
import { defaultFolders, type E2EState, STATE_ENV } from "./state";

const e2eDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoDir = path.dirname(e2eDir);
const ARTIFACTS_DIR = path.join(e2eDir, "artifacts");

// One daemon per run. The returned function is Playwright's global teardown, and the daemon also
// registers an exit hook, so it stops even when a test or this setup throws.
export default async function globalSetup() {
  const daemon = await startIsolatedDaemon({
    artifactsDir: ARTIFACTS_DIR,
    keepHome: process.env.PASEO_E2E_KEEP_HOME === "1",
  });
  try {
    const expected = process.env.PASEO_VERSION?.trim();
    if (expected && /^\d/.test(expected) && expected !== daemon.daemonVersion) {
      throw new Error(`PASEO_VERSION=${expected} but the daemon reports ${daemon.daemonVersion}`);
    }
    console.log(
      `[e2e] Paseo ${daemon.daemonVersion} (cli ${daemon.cliVersion}) at ${daemon.origin}, home ${daemon.home}`,
    );

    const fixtures = await seedFixtures(path.join(daemon.home, "fixtures"));
    const plugin = await installPlugin(daemon, path.join(repoDir, PLUGIN_ID));
    const workspace = await createWorkspace(daemon, fixtures.project, "Fixture");
    const state: E2EState = {
      cliVersion: daemon.cliVersion,
      daemonVersion: daemon.daemonVersion,
      home: daemon.home,
      port: daemon.port,
      origin: daemon.origin,
      serverId: daemon.serverId,
      pluginId: plugin.id,
      fixtures,
      workspaceId: workspace.workspaceId,
      workspaceTitle: workspace.title,
    };

    const client = await connectExplorerClient(daemon.port, plugin.id);
    try {
      const saved = await client.writeAllowedFolders(defaultFolders(state));
      if (saved.status !== "saved") {
        throw new Error(`Seeding settings failed: ${JSON.stringify(saved)}`);
      }
    } finally {
      await client.close();
    }

    process.env[STATE_ENV] = JSON.stringify(state);
  } catch (error) {
    await daemon.stop();
    throw error;
  }
  return async () => {
    await daemon.stop();
  };
}
