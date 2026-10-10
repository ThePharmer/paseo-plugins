// Runs a command in every plugin of this repo. A plugin is a top-level directory with a
// paseo-plugin.json, so adding one needs no edit here. Each plugin keeps its own package.json and
// package-lock.json because Git installs run `npm ci` inside the plugin directory.
//
//   node scripts/plugins.mjs list            print plugin directories
//   node scripts/plugins.mjs ci              npm ci (with retry) in each plugin
//   node scripts/plugins.mjs run <script>    npm run <script> in each plugin

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NPM_RETRY = path.join(REPO_ROOT, "scripts", "npm-retry.mjs");

export function listPlugins(repoRoot = REPO_ROOT) {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .filter((entry) => existsSync(path.join(repoRoot, entry.name, "paseo-plugin.json")))
    .map((entry) => entry.name)
    .sort();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
  });
  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function commandFor(action, rest) {
  if (action === "ci") return [process.execPath, [NPM_RETRY, "ci", ...rest]];
  if (action === "run" && rest.length > 0) return ["npm", ["run", ...rest]];
  return null;
}

function main(argv) {
  const [action, ...rest] = argv;
  const plugins = listPlugins();
  if (action === "list") {
    console.log(plugins.join("\n"));
    return 0;
  }
  const command = commandFor(action, rest);
  if (!command) {
    console.error("Usage: node scripts/plugins.mjs list | ci | run <script> [args...]");
    return 2;
  }
  if (plugins.length === 0) {
    console.error("No plugins found (no top-level directory has a paseo-plugin.json).");
    return 1;
  }
  for (const plugin of plugins) {
    console.log(`\n> ${plugin}: ${[action, ...rest].join(" ")}`);
    const status = run(command[0], command[1], path.join(REPO_ROOT, plugin));
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
