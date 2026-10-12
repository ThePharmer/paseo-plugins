import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgs, planReleases, publish } from "./release-publish.mjs";

const RELEASE = {
  plugin: "file-explorer",
  version: "0.1.0",
  tag: "file-explorer/v0.1.0",
  title: "file-explorer 0.1.0",
  body: "notes\n",
  prerelease: false,
};

/** A fake exec that records calls and answers from `remoteTags` and `releases`. */
function fakeExec({ remoteTags = [], releases = [] } = {}) {
  const calls = [];
  const exec = (command, args) => {
    const call = [command, ...args];
    if (command === "gh" && args[1] === "create") {
      call.notes = readFileSync(args[args.indexOf("--notes-file") + 1], "utf8");
    }
    calls.push(call);
    if (command === "git" && args[0] === "ls-remote") {
      const stdout = remoteTags.map((tag) => `abc\trefs/tags/${tag}\n`).join("");
      return { status: 0, stdout, stderr: "" };
    }
    if (command === "gh" && args[1] === "view") {
      return releases.includes(args[2])
        ? { status: 0, stdout: "{}", stderr: "" }
        : { status: 1, stdout: "", stderr: "release not found" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const quiet = () => {};

test("tags, pushes and releases a version with no tag", () => {
  const { exec, calls } = fakeExec();
  const outcomes = publish({ plan: [RELEASE], repo: "o/r", exec, log: quiet });

  assert.deepEqual(outcomes, [{ tag: RELEASE.tag, action: "release" }]);
  assert.deepEqual(
    calls.map((call) => call.slice(0, 3).join(" ")),
    [
      "git ls-remote --tags",
      "git tag --annotate",
      "git push origin",
      "gh release view",
      "gh release create",
    ],
  );
  assert.deepEqual(calls[2], ["git", "push", "origin", "refs/tags/file-explorer/v0.1.0"]);
  const create = calls[4];
  assert.equal(create[create.indexOf("--title") + 1], "file-explorer 0.1.0");
  assert.equal(create[create.indexOf("--repo") + 1], "o/r");
  assert.ok(create.includes("--verify-tag"));
  assert.ok(!create.includes("--prerelease"));
  assert.equal(create.notes, "notes\n");
});

test("does nothing when the tag and release exist", () => {
  const { exec, calls } = fakeExec({ remoteTags: [RELEASE.tag], releases: [RELEASE.tag] });
  const outcomes = publish({ plan: [RELEASE], exec, log: quiet });

  assert.deepEqual(outcomes, [{ tag: RELEASE.tag, action: "skip" }]);
  assert.deepEqual(
    calls.map((call) => call.slice(0, 3).join(" ")),
    ["git ls-remote --tags", "gh release view"],
  );
});

test("creates only the release when the tag exists without one", () => {
  const { exec, calls } = fakeExec({ remoteTags: [RELEASE.tag] });
  publish({ plan: [{ ...RELEASE, prerelease: true }], exec, log: quiet });

  assert.deepEqual(
    calls.map((call) => call.slice(0, 3).join(" ")),
    ["git ls-remote --tags", "gh release view", "gh release create"],
  );
  assert.ok(calls[2].includes("--prerelease"));
});

test("dry run only lists remote tags", () => {
  const { exec, calls } = fakeExec({ remoteTags: ["other/v1.0.0"] });
  const lines = [];
  const outcomes = publish({
    plan: [RELEASE],
    dryRun: true,
    exec,
    log: (line) => lines.push(line),
  });

  assert.deepEqual(outcomes, [{ tag: RELEASE.tag, action: "release" }]);
  assert.deepEqual(calls, [["git", "ls-remote", "--tags", "origin"]]);
  assert.match(lines.join("\n"), /would tag file-explorer\/v0\.1\.0/);
});

test("fails when a git command fails", () => {
  const exec = (command, args) =>
    command === "git" && args[0] === "push"
      ? { status: 1, stdout: "", stderr: "denied" }
      : fakeExec().exec(command, args);
  assert.throws(
    () => publish({ plan: [RELEASE], exec, log: quiet }),
    /git push .* failed:\ndenied/,
  );
});

test("plans releases from package.json and CHANGELOG.md", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "release-publish-test-"));
  try {
    for (const [name, version] of [
      ["alpha", "0.1.0"],
      ["beta", "1.0.0-rc.1"],
    ]) {
      await mkdir(path.join(dir, name));
      await writeFile(path.join(dir, name, "paseo-plugin.json"), "{}");
      await writeFile(path.join(dir, name, "package.json"), JSON.stringify({ version }));
      await writeFile(
        path.join(dir, name, "CHANGELOG.md"),
        `# Changelog\n\n## ${version} - 2026-10-12\n\n### Added\n\n- Added ${name}\n`,
      );
    }
    const plan = planReleases({ repoRoot: dir, repo: "o/r" });
    assert.deepEqual(
      plan.map(({ tag, title, prerelease }) => [tag, title, prerelease]),
      [
        ["alpha/v0.1.0", "alpha 0.1.0", false],
        ["beta/v1.0.0-rc.1", "beta 1.0.0-rc.1", true],
      ],
    );
    assert.match(plan[0].body, /^### Added\n\n- Added alpha\n\n### Install\n/);
    assert.match(plan[0].body, /paseo plugin install git:o\/r:alpha --ref alpha\/v0\.1\.0/);

    await writeFile(path.join(dir, "alpha", "package.json"), JSON.stringify({ version: "0.2.0" }));
    assert.throws(() => planReleases({ repoRoot: dir }), /package\.json says 0\.2\.0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parses --dry-run", () => {
  assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true, help: false });
  assert.throws(() => parseArgs(["--force"]), /Unknown argument/);
});
