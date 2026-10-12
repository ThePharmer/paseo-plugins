#!/usr/bin/env node

// Tags and publishes every plugin whose package.json version has no release yet. Runs on push to
// main (.github/workflows/release.yml) after release-check.mjs.
//
// For each plugin whose tag <plugin>/v<version> is missing on origin, this creates an annotated
// tag at HEAD, pushes it, and creates a GitHub Release titled "<plugin> <version>" with the
// version's CHANGELOG.md entry and an install command. A tag that exists without a release (an
// earlier run failed halfway) only gets its release. Re-running with every tag and release in
// place does nothing.
//
//   node scripts/release-publish.mjs             publish (needs gh authenticated, e.g. GH_TOKEN)
//   node scripts/release-publish.mjs --dry-run   print the plan; only reads origin's tags

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins } from "./plugins.mjs";
import {
  checkPlugin,
  DEFAULT_REPO,
  isPrerelease,
  parseLsRemoteTags,
  releaseBody,
  releaseNotes,
  releaseTitle,
  tagName,
} from "./release-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "origin";

const HELP_TEXT = `Usage: node scripts/release-publish.mjs [--dry-run]

Tags <plugin>/v<version> and creates a GitHub Release for each plugin version not yet released.

  --dry-run  print what would be tagged and released; create and push nothing

The release repo is GITHUB_REPOSITORY (owner/repo), or ${DEFAULT_REPO} when unset.`;

/**
 * One release per plugin, from its package.json and CHANGELOG.md. Throws when a plugin fails
 * release-check's rules.
 */
export function planReleases({ repoRoot = REPO_ROOT, repo = DEFAULT_REPO } = {}) {
  return listPlugins(repoRoot).map((plugin) => {
    const pluginDir = path.join(repoRoot, plugin);
    const { version } = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8"));
    const changelogPath = path.join(pluginDir, "CHANGELOG.md");
    const changelogText = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null;
    const errors = checkPlugin({ plugin, version, changelogText });
    if (errors.length > 0) throw new Error(errors.join("\n"));
    const tag = tagName(plugin, version);
    return {
      plugin,
      version,
      tag,
      title: releaseTitle(plugin, version),
      body: releaseBody({ notes: releaseNotes(changelogText, version), repo, plugin, tag }),
      prerelease: isPrerelease(version),
    };
  });
}

function defaultExec(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function withNotesFile(body, callback) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
  const file = path.join(dir, "notes.md");
  writeFileSync(file, body);
  try {
    return callback(file);
  } finally {
    unlinkSync(file);
    rmdirSync(dir);
  }
}

/**
 * Publishes every planned release that is missing. `exec(command, args, { cwd })` returns
 * { status, stdout, stderr }; tests pass a fake. Returns one { tag, action } per release.
 */
export function publish({
  plan,
  repo = DEFAULT_REPO,
  repoRoot = REPO_ROOT,
  dryRun = false,
  exec = defaultExec,
  log = console.log,
}) {
  const run = (command, args) => {
    const result = exec(command, args, { cwd: repoRoot });
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout;
  };

  let remoteTags;
  const lsRemote = exec("git", ["ls-remote", "--tags", REMOTE], { cwd: repoRoot });
  if (lsRemote.status === 0) remoteTags = parseLsRemoteTags(lsRemote.stdout);
  else if (dryRun) {
    log(`warning: could not list tags on ${REMOTE}; assuming none exist.`);
    remoteTags = new Set();
  } else throw new Error(`git ls-remote --tags ${REMOTE} failed:\n${lsRemote.stderr}`);

  const outcomes = [];
  for (const release of plan) {
    const hasTag = remoteTags.has(release.tag);
    if (dryRun) {
      if (hasTag) {
        log(`skip ${release.tag}: tag exists on ${REMOTE}`);
        outcomes.push({ tag: release.tag, action: "skip" });
        continue;
      }
      log(
        [
          `would tag ${release.tag} at HEAD and push it to ${REMOTE}`,
          `would create release "${release.title}" in ${repo}${release.prerelease ? " (prerelease)" : ""} with notes:`,
          ...release.body.split("\n").map((line) => `  | ${line}`),
        ].join("\n"),
      );
      outcomes.push({ tag: release.tag, action: "release" });
      continue;
    }

    if (!hasTag) {
      run("git", ["tag", "--annotate", release.tag, "--message", release.title, "HEAD"]);
      run("git", ["push", REMOTE, `refs/tags/${release.tag}`]);
      log(`tagged ${release.tag}`);
    }
    const view = exec("gh", ["release", "view", release.tag, "--repo", repo, "--json", "tagName"], {
      cwd: repoRoot,
    });
    if (view.status === 0) {
      log(`skip ${release.tag}: release exists`);
      outcomes.push({ tag: release.tag, action: hasTag ? "skip" : "tag" });
      continue;
    }
    if (!/not found/i.test(view.stderr)) {
      throw new Error(`gh release view ${release.tag} failed:\n${view.stderr}`);
    }
    withNotesFile(release.body, (notesFile) =>
      run("gh", [
        "release",
        "create",
        release.tag,
        "--repo",
        repo,
        "--title",
        release.title,
        "--notes-file",
        notesFile,
        "--verify-tag",
        ...(release.prerelease ? ["--prerelease"] : []),
      ]),
    );
    log(`released ${release.title} (${release.tag})`);
    outcomes.push({ tag: release.tag, action: "release" });
  }
  return outcomes;
}

export function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
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
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const plan = planReleases({ repo });
  if (plan.length === 0) {
    console.error("No plugins found (no top-level directory has a paseo-plugin.json).");
    return 1;
  }
  const outcomes = publish({ plan, repo, dryRun: options.dryRun });
  if (outcomes.every((outcome) => outcome.action === "skip")) console.log("Nothing to release.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
