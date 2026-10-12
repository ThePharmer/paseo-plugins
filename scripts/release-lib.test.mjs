import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkPlugin,
  compareSemver,
  installCommand,
  isPrerelease,
  latestRelease,
  parseChangelog,
  parseLsRemoteTags,
  releaseBody,
  releaseNotes,
  tagName,
  withoutUnreleased,
} from "./release-lib.mjs";

const changelog = (...entries) => ["# Changelog", "", ...entries].join("\n");
const ENTRY_010 = [
  "## 0.1.0 - 2026-10-12",
  "",
  "First release.",
  "",
  "### Added",
  "",
  "- Added X ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))",
  "",
].join("\n");
const ENTRY_011 = ["## 0.1.1 - 2026-10-20", "", "### Fixed", "", "- Fixed Y", ""].join("\n");
const UNRELEASED = ["## Unreleased", "", "### Improved", "", "- Improved Z", ""].join("\n");

test("parses entries newest first with their bodies", () => {
  const entries = parseChangelog(changelog(UNRELEASED, ENTRY_011, ENTRY_010));

  assert.deepEqual(
    entries.map(({ version, date }) => [version, date]),
    [
      ["Unreleased", null],
      ["0.1.1", "2026-10-20"],
      ["0.1.0", "2026-10-12"],
    ],
  );
  assert.equal(entries[1].body, "### Fixed\n\n- Fixed Y");
  assert.equal(latestRelease(entries).version, "0.1.1");
});

test("accepts CRLF, an intro paragraph and ## inside code fences", () => {
  const text = changelog(
    "Intro text.",
    "",
    "## 1.0.0 - 2026-01-31",
    "",
    "```md",
    "## not a heading",
    "```",
  ).replaceAll("\n", "\r\n");

  const [entry] = parseChangelog(text);
  assert.equal(entry.version, "1.0.0");
  assert.match(entry.body, /## not a heading/);
});

test("rejects malformed headings, non-semver versions and bad dates", () => {
  const cases = [
    ["## 0.1.0 2026-10-12\n\n- x", /malformed heading/],
    ["## v0.1.0 - 2026-10-12\n\n- x", /"v0\.1\.0" is not a semver version/],
    ["## 0.1 - 2026-10-12\n\n- x", /"0\.1" is not a semver/],
    ["## 0.1.0 - 2026-13-01\n\n- x", /date "2026-13-01"/],
    ["## 0.1.0 - 12/10/2026\n\n- x", /date "12\/10\/2026"/],
    ["## 0.1.0 - 2026-02-30\n\n- x", /date "2026-02-30"/],
    ["##0.1.0 - 2026-10-12\n\n- x", /malformed heading/],
    ["## unreleased\n\n- x", /malformed heading/],
  ];
  for (const [entry, pattern] of cases) {
    assert.throws(() => parseChangelog(changelog(entry)), pattern, entry);
  }
});

test("rejects duplicates, misplaced Unreleased, wrong order, empty notes and a missing title", () => {
  assert.throws(
    () => parseChangelog(changelog(ENTRY_010, ENTRY_010)),
    /duplicate entry for 0\.1\.0/,
  );
  assert.throws(
    () => parseChangelog(changelog(ENTRY_010, UNRELEASED)),
    /"## Unreleased" must be the first entry/,
  );
  assert.throws(
    () => parseChangelog(changelog(ENTRY_010, ENTRY_011)),
    /0\.1\.1 is listed below 0\.1\.0/,
  );
  assert.throws(
    () => parseChangelog(changelog("## 0.2.0 - 2026-10-12", "")),
    /0\.2\.0 has no notes/,
  );
  assert.throws(() => parseChangelog(ENTRY_010), /first line must be "# Changelog"/);
  assert.deepEqual(
    parseChangelog(changelog("## Unreleased", "", ENTRY_010)).map((e) => e.version),
    ["Unreleased", "0.1.0"],
  );
});

test("reports every problem at once", () => {
  assert.throws(
    () => parseChangelog(changelog("## x - y", "", "## 1.0.0 - 2026-1-1", "", "- a")),
    (error) => error.message.split("\n- ").length === 3,
  );
});

test("releaseNotes returns the entry body without its heading", () => {
  const text = changelog(UNRELEASED, ENTRY_011, ENTRY_010);
  assert.equal(
    releaseNotes(text, "0.1.0"),
    "First release.\n\n### Added\n\n- Added X ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))",
  );
  assert.throws(() => releaseNotes(text, "0.2.0"), /no "## 0\.2\.0 - YYYY-MM-DD" entry/);
});

test("tag names are <plugin>/v<version>, never bare", () => {
  assert.equal(tagName("file-explorer", "0.1.0"), "file-explorer/v0.1.0");
  assert.equal(tagName("file-explorer", "1.0.0-rc.1"), "file-explorer/v1.0.0-rc.1");
  assert.throws(() => tagName("", "0.1.0"), /Invalid plugin name/);
  assert.throws(() => tagName("a/b", "0.1.0"), /Invalid plugin name/);
  assert.throws(() => tagName("file-explorer", "v0.1.0"), /Not a semver/);
});

test("compares semver precedence including prereleases", () => {
  const ordered = [
    "0.0.9",
    "0.1.0-alpha",
    "0.1.0-alpha.1",
    "0.1.0-alpha.beta",
    "0.1.0-beta.2",
    "0.1.0-beta.11",
    "0.1.0",
    "0.1.10",
    "0.2.0",
    "1.0.0",
    "10.0.0",
  ];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = 0; j < ordered.length; j += 1) {
      assert.equal(
        compareSemver(ordered[i], ordered[j]),
        Math.sign(i - j),
        `${ordered[i]} ${ordered[j]}`,
      );
    }
  }
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0"), 0);
  assert.throws(() => compareSemver("1.0", "1.0.0"), /Not a semver/);
});

test("only versions with a prerelease suffix are prereleases", () => {
  assert.equal(isPrerelease("0.1.0"), false);
  assert.equal(isPrerelease("0.0.1"), false);
  assert.equal(isPrerelease("1.0.0-rc.1"), true);
  assert.equal(isPrerelease("1.0.0+build"), false);
});

test("withoutUnreleased drops only the Unreleased section", () => {
  assert.equal(
    withoutUnreleased(changelog(UNRELEASED, ENTRY_010)),
    withoutUnreleased(changelog(ENTRY_010)),
  );
  assert.notEqual(
    withoutUnreleased(changelog(ENTRY_011, ENTRY_010)),
    withoutUnreleased(changelog(ENTRY_010)),
  );
});

const PLUGIN = "file-explorer";

test("checkPlugin passes when the top released entry matches package.json", () => {
  assert.deepEqual(
    checkPlugin({
      plugin: PLUGIN,
      version: "0.1.0",
      changelogText: changelog(UNRELEASED, ENTRY_010),
    }),
    [],
  );
});

test("checkPlugin requires a CHANGELOG.md that parses and matches the version", () => {
  assert.match(
    checkPlugin({ plugin: PLUGIN, version: "0.1.0", changelogText: null })[0],
    /CHANGELOG\.md is missing/,
  );
  assert.match(
    checkPlugin({ plugin: PLUGIN, version: "0.1.0", changelogText: "# Changelog\n\n## bad\n" })[0],
    /malformed heading/,
  );
  assert.match(
    checkPlugin({ plugin: PLUGIN, version: "0.1.1", changelogText: changelog(ENTRY_010) })[0],
    /top released CHANGELOG\.md entry is 0\.1\.0 but package\.json says 0\.1\.1/,
  );
  assert.match(
    checkPlugin({ plugin: PLUGIN, version: "0.1.0", changelogText: changelog(UNRELEASED) })[0],
    /no released entry/,
  );
});

test("checkPlugin fails when CHANGELOG.md changed without a version bump", () => {
  const errors = checkPlugin({
    plugin: PLUGIN,
    version: "0.1.0",
    changelogText: changelog(ENTRY_010.replace("First release.", "First release, edited.")),
    base: { version: "0.1.0", changelogText: changelog(ENTRY_010) },
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /CHANGELOG\.md changed but package\.json version is still 0\.1\.0/);
  assert.match(errors[0], /Bump the version/);
  assert.match(errors[0], /move the notes under "## Unreleased"/);
});

test("checkPlugin allows changing only the Unreleased section without a bump", () => {
  for (const before of [
    changelog(ENTRY_010),
    changelog("## Unreleased", "", "- old", "", ENTRY_010),
  ]) {
    assert.deepEqual(
      checkPlugin({
        plugin: PLUGIN,
        version: "0.1.0",
        changelogText: changelog(UNRELEASED, ENTRY_010),
        base: { version: "0.1.0", changelogText: before },
      }),
      [],
    );
  }
});

test("checkPlugin accepts a bump with a matching entry and rejects a decrease", () => {
  assert.deepEqual(
    checkPlugin({
      plugin: PLUGIN,
      version: "0.1.1",
      changelogText: changelog(ENTRY_011, ENTRY_010),
      base: { version: "0.1.0", changelogText: changelog(ENTRY_010) },
    }),
    [],
  );
  const errors = checkPlugin({
    plugin: PLUGIN,
    version: "0.1.0",
    changelogText: changelog(ENTRY_010),
    base: { version: "0.1.1", changelogText: changelog(ENTRY_011, ENTRY_010) },
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /version went from 0\.1\.1 to 0\.1\.0; a new version must be greater/);
});

test("checkPlugin requires an entry for a bumped version", () => {
  const errors = checkPlugin({
    plugin: PLUGIN,
    version: "0.1.1",
    changelogText: changelog(ENTRY_010),
    base: { version: "0.1.0", changelogText: changelog(ENTRY_010) },
  });
  assert.match(errors.join("\n"), /entry is 0\.1\.0 but package\.json says 0\.1\.1/);
});

test("checkPlugin treats a plugin missing at the base as new", () => {
  assert.deepEqual(
    checkPlugin({
      plugin: PLUGIN,
      version: "0.1.0",
      changelogText: changelog(ENTRY_010),
      base: { version: null, changelogText: null },
    }),
    [],
  );
});

test("checkPlugin fails when a CHANGELOG.md is added to an existing plugin without a bump", () => {
  assert.match(
    checkPlugin({
      plugin: PLUGIN,
      version: "0.1.0",
      changelogText: changelog(ENTRY_010),
      base: { version: "0.1.0", changelogText: null },
    }).join("\n"),
    /CHANGELOG\.md changed/,
  );
});

test("parseLsRemoteTags reads tag names and peeled refs", () => {
  const output = [
    "aaa\trefs/tags/file-explorer/v0.1.0",
    "bbb\trefs/tags/file-explorer/v0.1.0^{}",
    "ccc\trefs/heads/main",
    "",
  ].join("\n");
  assert.deepEqual([...parseLsRemoteTags(output)], ["file-explorer/v0.1.0"]);
});

test("release body is the notes plus a pinned install command", () => {
  const tag = "file-explorer/v0.1.0";
  assert.equal(
    installCommand({ plugin: PLUGIN, tag }),
    "paseo plugin install git:ThePharmer/paseo-plugins:file-explorer --ref file-explorer/v0.1.0",
  );
  const body = releaseBody({
    notes: "### Added\n\n- X\n",
    repo: "someone/fork",
    plugin: PLUGIN,
    tag,
  });
  assert.equal(
    body,
    [
      "### Added",
      "",
      "- X",
      "",
      "### Install",
      "",
      "```bash",
      "paseo plugin install git:someone/fork:file-explorer --ref file-explorer/v0.1.0",
      "```",
      "",
    ].join("\n"),
  );
});
