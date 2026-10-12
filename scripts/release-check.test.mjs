import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { checkRepo, parseArgs } from "./release-check.mjs";

const ENTRY = (version, note = "- Added X") =>
  `## ${version} - 2026-10-12\n\n### Added\n\n${note}\n`;
const CHANGELOG = (...entries) => `# Changelog\n\n${entries.join("\n")}`;

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

async function writePlugin(name, { version, changelog }) {
  await mkdir(path.join(dir, name), { recursive: true });
  await writeFile(path.join(dir, name, "paseo-plugin.json"), "{}");
  await writeFile(path.join(dir, name, "package.json"), JSON.stringify({ name, version }));
  if (changelog !== undefined) await writeFile(path.join(dir, name, "CHANGELOG.md"), changelog);
}

function commitAll(message) {
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
}

const errorsByPlugin = (results) =>
  Object.fromEntries(results.map((result) => [result.plugin, result.errors.join("\n")]));

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "release-check-test-"));
  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("checks plugins against a base ref in a real git repo", async () => {
  await writePlugin("alpha", { version: "0.1.0", changelog: CHANGELOG(ENTRY("0.1.0")) });
  await writePlugin("beta", { version: "0.1.0", changelog: CHANGELOG(ENTRY("0.1.0")) });
  await writePlugin("gamma", { version: "0.2.0", changelog: CHANGELOG(ENTRY("0.2.0")) });
  const base = commitAll("base");

  assert.deepEqual(errorsByPlugin(checkRepo({ repoRoot: dir })), {
    alpha: "",
    beta: "",
    gamma: "",
  });

  // alpha: notes edited without a bump. beta: only Unreleased added. gamma: version decreased.
  // delta: new plugin. epsilon: new plugin without a changelog.
  await writeFile(
    path.join(dir, "alpha", "CHANGELOG.md"),
    CHANGELOG(ENTRY("0.1.0", "- Added X, reworded")),
  );
  await writeFile(
    path.join(dir, "beta", "CHANGELOG.md"),
    CHANGELOG("## Unreleased\n\n- Later\n", ENTRY("0.1.0")),
  );
  await writePlugin("gamma", { version: "0.1.9", changelog: CHANGELOG(ENTRY("0.1.9")) });
  await writePlugin("delta", { version: "0.0.1", changelog: CHANGELOG(ENTRY("0.0.1")) });
  await writePlugin("epsilon", { version: "0.0.1" });
  commitAll("head");

  const errors = errorsByPlugin(checkRepo({ repoRoot: dir, base }));
  assert.match(errors.alpha, /CHANGELOG\.md changed but package\.json version is still 0\.1\.0/);
  assert.equal(errors.beta, "");
  assert.match(errors.gamma, /version went from 0\.2\.0 to 0\.1\.9/);
  assert.equal(errors.delta, "");
  assert.match(errors.epsilon, /epsilon\/CHANGELOG\.md is missing/);

  // Without a base only the current files are checked.
  const noBase = errorsByPlugin(checkRepo({ repoRoot: dir }));
  assert.equal(noBase.alpha, "");
  assert.equal(noBase.gamma, "");
});

test("rejects an unknown base ref", () => {
  assert.throws(() => checkRepo({ repoRoot: dir, base: "origin/nope" }), /Base ref "origin\/nope"/);
});

test("parses --base", () => {
  assert.deepEqual(parseArgs(["--base", "origin/main"]), { base: "origin/main", help: false });
  assert.throws(() => parseArgs(["--base"]), /Unknown argument/);
});
