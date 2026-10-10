import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  collectRecords,
  compareRecords,
  compareUrl,
  DRIFT_LABEL,
  issueTitle,
  parseArgs,
  parseUpstreamHeaders,
  renderIssueBody,
  renderReport,
  syncIssue,
} from "./check-upstream-drift.mjs";

// Built at runtime so this file never matches the header pattern itself.
const SHA = "ab10a6694ccf068959d1a6b67b6c915e21a9fe91";
const OTHER_SHA = "1".repeat(40);
const repo = ["getpaseo", "paseo"].join("/");
const header = (verb, sha = SHA, tag = " (v0.11.1)") => `// ${verb} from ${repo}@${sha}${tag}`;
const LATEST = { tag: "v0.11.2", commit: "7".repeat(40) };

test("parses a single-path header and stops at Modified", () => {
  const text = [
    header("Copied"),
    "// packages/server/src/server/path-utils.ts (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).",
    "// Modified: only the helpers in other/place.ts.",
    "",
    'import x from "./y";',
  ].join("\n");

  assert.deepEqual(parseUpstreamHeaders(text), [
    { line: 1, commit: SHA, label: "v0.11.1", paths: ["packages/server/src/server/path-utils.ts"] },
  ]);
});

test("collects paths wrapped across lines and joined with and", () => {
  const text = [
    header("Copied"),
    "// packages/app/src/components/file-explorer-pane.tsx (TreeRowItem) and",
    "// packages/app/src/components/tree-primitives.tsx (Apache-2.0, Copyright (c) 2025-present",
    "// Mohamed Boudra).",
    "// Modified: plain styles; see file-explorer-pane.tsx.",
  ].join("\n");

  assert.deepEqual(parseUpstreamHeaders(text)[0].paths, [
    "packages/app/src/components/file-explorer-pane.tsx",
    "packages/app/src/components/tree-primitives.tsx",
  ]);
});

test("accepts Ported, Partly copied and prefixed verbs, and headers mid-file", () => {
  const text = [
    header("Token coloring ported"),
    "// packages/app/src/styles/syntax-token-styles.ts (Apache-2.0).",
    "",
    "export const a = 1;",
    "",
    header("Partly copied"),
    "// packages/app/src/file-pane/bar.tsx (Apache-2.0).",
    "export const b = 2;",
  ].join("\r\n");

  const headers = parseUpstreamHeaders(text);
  assert.deepEqual(
    headers.map((h) => [h.line, h.paths]),
    [
      [1, ["packages/app/src/styles/syntax-token-styles.ts"]],
      [6, ["packages/app/src/file-pane/bar.tsx"]],
    ],
  );
});

test("stops at Changes:, a blank comment line, or code", () => {
  for (const terminator of ["// Changes: see a/b.ts", "//", "const z = 'c/d.ts';"]) {
    const text = [header("Copied"), "// packages/x/y.ts", terminator, "// e/f.ts"].join("\n");
    assert.deepEqual(parseUpstreamHeaders(text)[0].paths, ["packages/x/y.ts"], terminator);
  }
});

test("ignores short or non-hex refs, other repos and prose mentions", () => {
  const text = [
    `// Copied from ${repo}@ab10a66 (v0.11.1)`,
    `// Copied from someone/else@${SHA}`,
    `// We once copied things from ${repo}@main into here.`,
    `const s = "Copied from ${repo}@${SHA}";`,
  ].join("\n");

  assert.deepEqual(parseUpstreamHeaders(text), []);
});

test("supports # comments and a header without a tag label", () => {
  const text = [
    `# Copied from ${repo}@${OTHER_SHA}`,
    "# .github/workflows/ci.yml",
    "# Modified: x",
  ].join("\n");

  assert.deepEqual(parseUpstreamHeaders(text), [
    { line: 1, commit: OTHER_SHA, label: null, paths: [".github/workflows/ci.yml"] },
  ]);
});

test("collectRecords walks the tree, skips node_modules, and rejects path-less headers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "drift-test-"));
  try {
    await mkdir(path.join(dir, "plugin", "server"), { recursive: true });
    await mkdir(path.join(dir, "plugin", "node_modules", "dep"), { recursive: true });
    await writeFile(
      path.join(dir, "plugin", "server", "a.ts"),
      `${header("Copied")}\n// packages/a.ts and packages/b.ts\n`,
    );
    await writeFile(
      path.join(dir, "plugin", "node_modules", "dep", "x.js"),
      `${header("Copied")}\n// packages/z.ts\n`,
    );
    await writeFile(
      path.join(dir, "plugin", "README.md"),
      `${header("Copied")}\n// packages/md.ts\n`,
    );

    const records = await collectRecords(dir);
    assert.deepEqual(
      records.map((r) => [r.file, r.upstreamPath]),
      [
        ["plugin/server/a.ts", "packages/a.ts"],
        ["plugin/server/a.ts", "packages/b.ts"],
      ],
    );

    await writeFile(path.join(dir, "bad.mjs"), `${header("Copied")}\n// Modified: everything\n`);
    await assert.rejects(collectRecords(dir), /bad\.mjs:1: upstream header names no upstream path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compareUrl anchors the compare page on the file's SHA-256", () => {
  const upstreamPath = "packages/server/src/server/path-utils.ts";
  const digest = createHash("sha256").update(upstreamPath).digest("hex");

  assert.equal(
    compareUrl(SHA, "v0.11.2", upstreamPath),
    `https://github.com/getpaseo/paseo/compare/${SHA}...v0.11.2#diff-${digest}`,
  );
});

function record(upstreamPath, commit = SHA) {
  return { file: `local/${upstreamPath}`, line: 1, commit, label: "v0.11.1", upstreamPath };
}

test("compareRecords classifies unchanged, changed, removed and bad headers, fetching each once", async () => {
  const files = {
    [`${SHA}:same.ts`]: "a",
    [`v0.11.2:same.ts`]: "a",
    [`${SHA}:changed.ts`]: "a",
    [`v0.11.2:changed.ts`]: "b",
    [`${SHA}:removed.ts`]: "a",
  };
  const calls = [];
  const fetchText = async (ref, upstreamPath) => {
    calls.push(`${ref}:${upstreamPath}`);
    return files[`${ref}:${upstreamPath}`] ?? null;
  };
  const records = [
    record("same.ts"),
    record("changed.ts"),
    { ...record("changed.ts"), file: "another/copy.ts" },
    record("removed.ts"),
    record("typo.ts"),
  ];

  const results = await compareRecords(records, LATEST, fetchText);

  assert.deepEqual(
    results.map((r) => [r.file, r.status]),
    [
      ["local/same.ts", "unchanged"],
      ["local/changed.ts", "changed"],
      ["another/copy.ts", "changed"],
      ["local/removed.ts", "removed"],
      ["local/typo.ts", "missing-at-recorded"],
    ],
  );
  assert.equal(calls.length, new Set(calls).size, "each (ref, path) is fetched once");
  assert.equal(results[1].diffUrl, compareUrl(SHA, "v0.11.2", "changed.ts"));
});

test("compareRecords skips fetching when the recorded commit is the release commit", async () => {
  const results = await compareRecords([record("x.ts", LATEST.commit)], LATEST, async () => {
    throw new Error("should not fetch");
  });
  assert.equal(results[0].status, "unchanged");
});

const DRIFTED = [
  {
    ...record("changed.ts"),
    status: "changed",
    diffUrl: compareUrl(SHA, LATEST.tag, "changed.ts"),
    latestTag: LATEST.tag,
    latestCommit: LATEST.commit,
  },
  {
    ...record("same.ts"),
    status: "unchanged",
    diffUrl: "",
    latestTag: LATEST.tag,
    latestCommit: LATEST.commit,
  },
];

test("the report and issue body list only drifted files with both refs and the diff", () => {
  const report = renderReport(DRIFTED, LATEST);
  assert.match(report, /1 drifted:/);
  assert.match(report, /local\/changed\.ts:1 <- changed\.ts: changed/);
  assert.match(report, /recorded v0\.11\.1 \(ab10a6694ccf\), latest v0\.11\.2 \(777777777777\)/);
  assert.doesNotMatch(report, /same\.ts/);

  const body = renderIssueBody(DRIFTED, LATEST);
  assert.match(body, /\| `local\/changed\.ts` \| `changed\.ts` \| changed \|/);
  assert.ok(body.includes(`[diff](${DRIFTED[0].diffUrl})`));
  assert.ok(body.includes(`https://github.com/getpaseo/paseo/tree/${SHA}/changed.ts`));
  assert.doesNotMatch(body, /same\.ts/);
  assert.equal(renderReport([DRIFTED[1]], LATEST).endsWith("No drift."), true);
});

function fakeGitHub(openIssues = []) {
  const calls = [];
  let nextNumber = 100;
  return {
    calls,
    async listOpenIssues(label) {
      calls.push(["list", label]);
      return openIssues.map((issue) => ({ ...issue }));
    },
    async ensureLabel(name) {
      calls.push(["label", name]);
    },
    async createIssue(issue) {
      calls.push(["create", issue.title, issue.labels]);
      return { number: nextNumber++ };
    },
    async updateIssue(number, patch) {
      calls.push(["update", number, patch.state ?? patch.title]);
    },
    async comment(number, body) {
      calls.push(["comment", number, body]);
    },
  };
}

test("creates one labeled issue when drift appears and none is open", async () => {
  const github = fakeGitHub();
  const outcome = await syncIssue({ results: DRIFTED, latest: LATEST, github });

  assert.deepEqual(outcome, { action: "created", issues: [100] });
  assert.deepEqual(github.calls, [
    ["list", DRIFT_LABEL],
    ["label", DRIFT_LABEL],
    ["create", "Upstream drift: v0.11.2", [DRIFT_LABEL]],
  ]);
});

test("updates the open issue instead of duplicating it, and closes extra ones", async () => {
  const github = fakeGitHub([
    { number: 9, title: issueTitle("v0.11.2"), body: "old" },
    { number: 4, title: issueTitle("v0.11.1"), body: "old" },
  ]);
  const outcome = await syncIssue({ results: DRIFTED, latest: LATEST, github });

  assert.deepEqual(outcome, { action: "updated", issues: [4] });
  assert.deepEqual(github.calls, [
    ["list", DRIFT_LABEL],
    ["comment", 9, "Superseded by #4."],
    ["update", 9, "closed"],
    ["update", 4, "Upstream drift: v0.11.2"],
    ["comment", 4, "Upstream released v0.11.2; the list above is current."],
  ]);
});

test("leaves an up-to-date issue alone", async () => {
  const body = renderIssueBody(DRIFTED, LATEST);
  const github = fakeGitHub([{ number: 4, title: issueTitle("v0.11.2"), body }]);

  assert.deepEqual(await syncIssue({ results: DRIFTED, latest: LATEST, github }), {
    action: "unchanged",
    issues: [4],
  });
  assert.deepEqual(github.calls, [["list", DRIFT_LABEL]]);
});

test("closes every open drift issue with a comment once nothing drifts", async () => {
  const github = fakeGitHub([{ number: 4, title: issueTitle("v0.11.1"), body: "old" }]);
  const outcome = await syncIssue({ results: [DRIFTED[1]], latest: LATEST, github });

  assert.deepEqual(outcome, { action: "closed", issues: [4] });
  assert.deepEqual(github.calls, [
    ["list", DRIFT_LABEL],
    ["comment", 4, "No upstream drift against v0.11.2. Closing."],
    ["update", 4, "closed"],
  ]);
});

test("does nothing when nothing drifts and no issue is open", async () => {
  const github = fakeGitHub();
  assert.deepEqual(await syncIssue({ results: [], latest: LATEST, github }), {
    action: "none",
    issues: [],
  });
});

test("parseArgs reads flags and rejects unknown ones", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--latest", "v1.0.0", "--json"]), {
    dryRun: true,
    json: true,
    failOnDrift: false,
    latest: "v1.0.0",
    help: false,
  });
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument: --nope/);
  assert.throws(() => parseArgs(["--latest"]), /Unknown argument: --latest/);
});
