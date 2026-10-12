// Loads each plugin's client bundle under the Hermes CLI and checks that it registers the
// contributions listed below.
//
// The Paseo app evaluates plugin client bundles from source with Hermes on iOS and Android, so a
// syntax or runtime feature Hermes mishandles breaks the plugin only on phones. Metro's Babel
// preset hides such gaps for app code; plugin bundles skip Metro. This test compiles each client
// entry with the esbuild options of Paseo's plugin compiler
// (packages/server/src/server/plugins/compiler.ts, client target), evaluates it the way
// packages/app/src/plugins/evaluate.ts does, and runs that under Hermes.
//
// Hermes CLI v0.13.0 is older than the Hermes in the Paseo app, and the Hermes CLI is not the app:
// this catches syntax and semantics Hermes rejects, not every app-only failure.
//
//   HERMES_BIN=/path/to/hermes node scripts/hermes-smoke/run.mjs [plugin...]
//
// esbuild, @babel/core and the Babel transforms are resolved from each plugin's node_modules, so
// a plugin with a client entry lists them in its devDependencies (see file-explorer).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "../plugins.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const RESULT_PREFIX = "HERMES_SMOKE_RESULT ";
const PLATFORMS = ["android", "ios"];

// What each plugin's client entry registers on a fresh host. A plugin with a client entry and no
// row here fails, so adding a plugin means adding its row.
const EXPECTED_CONTRIBUTIONS = {
  "file-explorer": [
    "addSettingsScreen:folders",
    "addScreen:browse",
    "addScreen:file",
    "addSidebarHeaderItem:browse",
    "addWorkspacePanel:folders",
    "addCommandCenterItem:browse-folders",
    "addCommandCenterItem:open-folders-explorer",
  ],
};

// Paseo's plugin compiler, client target. Keep in sync with compiler.ts.
const HOST_MODULES = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
];

// The harness itself goes through the transforms Metro applies for Hermes, as app code does.
// Without them esbuild's `for (let key ...)` interop closures misbehave under Hermes v0.13 and
// hand the plugin a broken React namespace.
const HERMES_TRANSFORMS = [
  ["@babel/plugin-transform-class-properties", { loose: true }],
  ["@babel/plugin-transform-private-methods", { loose: true }],
  ["@babel/plugin-transform-private-property-in-object", { loose: true }],
  ["@babel/plugin-transform-classes", {}],
  ["@babel/plugin-transform-block-scoping", {}],
];

// -Xes6-class turns on v0.13's experimental class support, so class syntax compiles and fails the
// way it does on phones ("Cannot read property 'prototype' of undefined"). Without the flag v0.13
// rejects any class at parse time.
// -Xmicrotask-queue runs promise callbacks the way React Native does.
const HERMES_FLAGS = ["-Xes6-class", "-Xmicrotask-queue"];

function clientEntry(pluginDir) {
  return ["index.client.tsx", "index.client.ts"]
    .map((name) => path.join(pluginDir, name))
    .find((file) => existsSync(file));
}

function pluginTools(pluginDir) {
  const require = createRequire(path.join(pluginDir, "package.json"));
  try {
    return {
      esbuild: require("esbuild"),
      babel: require("@babel/core"),
      plugins: HERMES_TRANSFORMS.map(([name, options]) => [require.resolve(name), options]),
    };
  } catch (error) {
    throw new Error(
      `${path.basename(pluginDir)} needs esbuild, @babel/core and the Hermes Babel transforms in its devDependencies`,
      { cause: error },
    );
  }
}

// Mirrors compileTarget(entry, "client") and the two string steps after it, minus the module
// boundary checks.
async function compileClient(tools, pluginDir, entry) {
  const result = await tools.esbuild.build({
    absWorkingDir: pluginDir,
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    supported: { "async-await": false },
    external: HOST_MODULES,
    treeShaking: true,
    logLevel: "silent",
    write: false,
  });
  const code = result.outputFiles[0].text.replaceAll("get: () => from[key]", "value: from[key]");
  return `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
}

async function buildHarness(tools, pluginDir, clientBundle) {
  const nodeEnv = ["process", "env", "NODE_ENV"].join(".");
  const result = await tools.esbuild.build({
    entryPoints: [path.join(SCRIPT_DIR, "harness.mjs")],
    bundle: true,
    format: "iife",
    target: "es2020",
    supported: { "async-await": false },
    define: { [nodeEnv]: '"production"' },
    nodePaths: [path.join(pluginDir, "node_modules")],
    logLevel: "warning",
    write: false,
    plugins: [
      {
        name: "plugin-client-bundle",
        setup(build) {
          build.onResolve({ filter: /^plugin-client-bundle$/ }, () => ({
            path: "plugin-client-bundle",
            namespace: "hermes-smoke",
          }));
          build.onLoad({ filter: /.*/, namespace: "hermes-smoke" }, () => ({
            contents: clientBundle,
            loader: "text",
          }));
        },
      },
    ],
  });
  const lowered = tools.babel.transformSync(result.outputFiles[0].text, {
    babelrc: false,
    configFile: false,
    sourceType: "script",
    compact: false,
    plugins: tools.plugins,
  });
  return lowered.code;
}

function runHermes(hermes, file) {
  const run = spawnSync(hermes, [...HERMES_FLAGS, file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) throw new Error(`Could not start Hermes at ${hermes}: ${run.error.message}`);
  const line = run.stdout.split("\n").find((output) => output.startsWith(RESULT_PREFIX));
  return {
    status: run.status,
    output: `${run.stdout}${run.stderr}`.trim(),
    result: line ? JSON.parse(line.slice(RESULT_PREFIX.length)) : null,
  };
}

function failures(run, expected) {
  if (!run.result) return [`no result line (exit ${run.status})`];
  const problems = [];
  if (!run.result.ok) {
    problems.push(`threw: ${run.result.error.message}\n${run.result.error.stack}`);
  }
  if (run.status !== 0) problems.push(`Hermes exited with ${run.status}`);
  const registered = [...run.result.registered].sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(registered) !== JSON.stringify(wanted)) {
    problems.push(`registered ${JSON.stringify(registered)}, expected ${JSON.stringify(wanted)}`);
  }
  return problems;
}

async function smokePlugin(hermes, plugin, workDir) {
  const pluginDir = path.join(REPO_ROOT, plugin);
  const entry = clientEntry(pluginDir);
  if (!entry) {
    console.log(`- ${plugin}: no client entry, skipped`);
    return true;
  }
  const expected = EXPECTED_CONTRIBUTIONS[plugin];
  if (!expected) {
    console.error(`x ${plugin}: add its contributions to EXPECTED_CONTRIBUTIONS in ${SCRIPT_DIR}`);
    return false;
  }
  const tools = pluginTools(pluginDir);
  const harness = await buildHarness(
    tools,
    pluginDir,
    await compileClient(tools, pluginDir, entry),
  );
  let passed = true;
  for (const platform of PLATFORMS) {
    const file = path.join(workDir, `${plugin}.${platform}.js`);
    await writeFile(file, `globalThis.__HERMES_SMOKE_PLATFORM__ = "${platform}";\n${harness}`);
    const run = runHermes(hermes, file);
    const problems = failures(run, expected);
    if (problems.length === 0) {
      console.log(`ok ${plugin} (${platform}): registered ${run.result.registered.join(", ")}`);
      continue;
    }
    passed = false;
    console.error(`x ${plugin} (${platform}):\n  ${problems.join("\n  ")}`);
    if (!run.result) console.error(run.output.split("\n").slice(0, 30).join("\n"));
  }
  return passed;
}

async function main(argv) {
  const hermes = process.env.HERMES_BIN;
  if (!hermes) {
    console.error("Set HERMES_BIN to a Hermes CLI binary (facebook/hermes release v0.13.0).");
    return 2;
  }
  const plugins = argv.length > 0 ? argv : listPlugins(REPO_ROOT);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "hermes-smoke-"));
  try {
    let passed = true;
    for (const plugin of plugins) {
      if (!(await smokePlugin(hermes, plugin, workDir))) passed = false;
    }
    return passed ? 0 : 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

process.exitCode = await main(process.argv.slice(2));
