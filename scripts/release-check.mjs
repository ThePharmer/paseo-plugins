#!/usr/bin/env node

// Checks every plugin's CHANGELOG.md against its package.json version.
//
//   node scripts/release-check.mjs                  every CHANGELOG.md parses and its top released
//                                                   entry matches package.json
//   node scripts/release-check.mjs --base <ref>     also compares with <ref> (a PR's base): a
//                                                   changed CHANGELOG.md needs a version bump unless
//                                                   only "## Unreleased" changed, and a new version
//                                                   must be greater than the base version
//
// A plugin missing at <ref> (a new plugin) is checked as if there were no base.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "./plugins.mjs";
import { checkPlugin } from "./release-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP_TEXT = `Usage: node scripts/release-check.mjs [--base <ref>]

Checks each plugin's CHANGELOG.md against its package.json version.

  --base <ref>  also compare with <ref>, e.g. origin/main on a pull request`;

function git(repoRoot, args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

/** File text at a ref, or null when the path does not exist there. The ref must be valid. */
export function readAtRef(repoRoot, ref, relativePath) {
  const result = git(repoRoot, ["show", `${ref}:${relativePath}`]);
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout : null;
}

function readVersion(packageJsonText, label) {
  try {
    return JSON.parse(packageJsonText).version ?? null;
  } catch (error) {
    throw new Error(`${label}: invalid JSON`, { cause: error });
  }
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * Checks every plugin under repoRoot, optionally against a base ref.
 * @returns {{ plugin: string, version: string | null, errors: string[] }[]}
 */
export function checkRepo({ repoRoot = REPO_ROOT, base = null } = {}) {
  if (base) {
    const verified = git(repoRoot, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    if (verified.status !== 0) {
      throw new Error(`Base ref "${base}" not found; fetch it first (git fetch origin <branch>)`);
    }
  }
  return listPlugins(repoRoot).map((plugin) => {
    const packageText = readIfExists(path.join(repoRoot, plugin, "package.json"));
    if (packageText === null) {
      return { plugin, version: null, errors: [`${plugin}/package.json is missing`] };
    }
    const version = readVersion(packageText, `${plugin}/package.json`);
    const changelogText = readIfExists(path.join(repoRoot, plugin, "CHANGELOG.md"));
    let baseState = null;
    if (base) {
      const basePackage = readAtRef(repoRoot, base, `${plugin}/package.json`);
      baseState = {
        version: basePackage === null ? null : readVersion(basePackage, `${base}:${plugin}`),
        changelogText: readAtRef(repoRoot, base, `${plugin}/CHANGELOG.md`),
      };
    }
    return {
      plugin,
      version,
      errors: checkPlugin({ plugin, version, changelogText, base: baseState }),
    };
  });
}

export function parseArgs(argv) {
  const options = { base: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--base" && argv[index + 1]) options.base = argv[++index];
    else throw new Error(`Unknown argument: ${arg}\n\n${HELP_TEXT}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  const results = checkRepo({ base: options.base });
  if (results.length === 0) {
    console.error("No plugins found (no top-level directory has a paseo-plugin.json).");
    return 1;
  }
  let failed = false;
  for (const result of results) {
    if (result.errors.length === 0) {
      console.log(`ok ${result.plugin} ${result.version}`);
      continue;
    }
    failed = true;
    for (const error of result.errors) console.error(`error: ${error}`);
  }
  if (options.base && !failed) console.log(`Compared with ${options.base}.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
