#!/usr/bin/env node

// Reports files copied from upstream Paseo whose upstream source changed since the copy.
//
// Every copied file carries a header like
//   // Copied from getpaseo/paseo@<40-hex commit> (v0.11.1)
//   // packages/server/src/server/path-utils.ts (Apache-2.0, ...)
//   // Modified: ...
// ("Ported from" and "Partly copied from" work the same way). For each upstream path named in a
// header, this compares the file at the recorded commit with the same path at the latest
// upstream release. With drift it opens or updates one issue labeled upstream-drift; without
// drift it closes any open one. --dry-run prints the report and touches nothing.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UPSTREAM_REPO = "getpaseo/paseo";
export const DRIFT_LABEL = "upstream-drift";
const ISSUE_MARKER = "<!-- upstream-drift-report -->";
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".yml", ".yaml"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP_TEXT = `Usage: node scripts/check-upstream-drift.mjs [--dry-run] [--json] [--fail-on-drift] [--latest <tag>]

Compares every file copied from ${UPSTREAM_REPO} with the latest upstream release.

  --dry-run        print the report; do not read or write issues
  --json           print the report as JSON
  --fail-on-drift  exit 1 when any file drifted
  --latest <tag>   compare against this tag instead of the latest release

Without --dry-run, GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) must be set.`;

const HEADER_PATTERN =
  /^\s*(\/\/|#|\*)\s*(?:[\w ]+\s)?(?:copied|ported)\s+from\s+getpaseo\/paseo@([0-9a-f]{40})\b(?:\s*\(([^)]*)\))?(.*)$/i;
const BLOCK_END_PATTERN = /^\s*(?:modified|changes)\s*:/i;
const UPSTREAM_PATH_PATTERN = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]*\w\.[A-Za-z0-9]+)(?![\w/])/g;

/**
 * Finds every upstream attribution header in a file's text.
 * @returns {{ line: number, commit: string, label: string | null, paths: string[] }[]}
 */
export function parseUpstreamHeaders(text) {
  const lines = text.split(/\r?\n/);
  const headers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADER_PATTERN.exec(lines[index]);
    if (!match) continue;
    const [, commentPrefix, commit, label, rest] = match;
    const block = [rest];
    for (let next = index + 1; next < lines.length; next += 1) {
      const body = stripComment(lines[next], commentPrefix);
      if (body === null || body.trim() === "" || BLOCK_END_PATTERN.test(body)) break;
      if (HEADER_PATTERN.test(lines[next])) break;
      block.push(body);
    }
    const paths = [
      ...new Set([...block.join(" ").matchAll(UPSTREAM_PATH_PATTERN)].map((m) => m[1])),
    ];
    headers.push({ line: index + 1, commit: commit.toLowerCase(), label: label ?? null, paths });
  }
  return headers;
}

function stripComment(line, prefix) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(prefix)) return null;
  return trimmed.slice(prefix.length);
}

/** Lists repo files that can carry a header, skipping dependencies. Paths use "/". */
export async function listCandidateFiles(repoRoot) {
  const found = [];
  async function walk(relativeDir) {
    const entries = await readdir(path.join(repoRoot, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(relative);
      } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(relative);
      }
    }
  }
  await walk("");
  return found.sort();
}

/**
 * One record per (local file, upstream path) pair.
 * @returns {Promise<{ file: string, line: number, commit: string, label: string | null, upstreamPath: string }[]>}
 */
export async function collectRecords(repoRoot) {
  const records = [];
  for (const file of await listCandidateFiles(repoRoot)) {
    const text = await readFile(path.join(repoRoot, file), "utf8");
    for (const header of parseUpstreamHeaders(text)) {
      if (header.paths.length === 0) {
        throw new Error(`${file}:${header.line}: upstream header names no upstream path`);
      }
      for (const upstreamPath of header.paths) {
        records.push({
          file,
          line: header.line,
          commit: header.commit,
          label: header.label,
          upstreamPath,
        });
      }
    }
  }
  return records;
}

/** GitHub's per-file anchor on a compare page is "diff-" plus the SHA-256 of the path. */
export function compareUrl(fromRef, toRef, upstreamPath, repo = UPSTREAM_REPO) {
  const anchor = createHash("sha256").update(upstreamPath).digest("hex");
  return `https://github.com/${repo}/compare/${fromRef}...${toRef}#diff-${anchor}`;
}

/**
 * Compares each record's upstream file at its recorded commit and at the latest release.
 * `fetchText(ref, path)` resolves to the file text, or null when the path does not exist at ref.
 */
export async function compareRecords(records, latest, fetchText) {
  const cache = new Map();
  const load = (ref, upstreamPath) => {
    const key = `${ref}\0${upstreamPath}`;
    if (!cache.has(key)) cache.set(key, fetchText(ref, upstreamPath));
    return cache.get(key);
  };
  const results = [];
  for (const record of records) {
    const base = { ...record, latestTag: latest.tag, latestCommit: latest.commit };
    const diffUrl = compareUrl(record.commit, latest.tag, record.upstreamPath);
    if (latest.commit && record.commit === latest.commit) {
      results.push({ ...base, status: "unchanged", diffUrl });
      continue;
    }
    const [recorded, current] = await Promise.all([
      load(record.commit, record.upstreamPath),
      load(latest.tag, record.upstreamPath),
    ]);
    let status = "unchanged";
    if (recorded === null) status = "missing-at-recorded";
    else if (current === null) status = "removed";
    else if (recorded !== current) status = "changed";
    results.push({ ...base, status, diffUrl });
  }
  return results;
}

export function driftedResults(results) {
  return results.filter((result) => result.status !== "unchanged");
}

export function issueTitle(latestTag) {
  return `Upstream drift: ${latestTag}`;
}

const STATUS_TEXT = {
  changed: "changed",
  removed: "removed upstream",
  "missing-at-recorded": "not found at the recorded commit (fix the header)",
};

function shortRef(commit) {
  return commit.slice(0, 12);
}

export function renderReport(results, latest) {
  const drifted = driftedResults(results);
  const latestRef = latest.commit ? `${latest.tag} (${shortRef(latest.commit)})` : latest.tag;
  const lines = [
    `Compared ${results.length} upstream source(s) in ${new Set(results.map((r) => r.file)).size} file(s) with ${UPSTREAM_REPO} ${latestRef}.`,
  ];
  if (drifted.length === 0) {
    lines.push("No drift.");
    return lines.join("\n");
  }
  lines.push(`${drifted.length} drifted:`);
  for (const result of drifted) {
    const recordedRef = result.label
      ? `${result.label} (${shortRef(result.commit)})`
      : shortRef(result.commit);
    lines.push(
      `- ${result.file}:${result.line} <- ${result.upstreamPath}: ${STATUS_TEXT[result.status]}`,
      `    recorded ${recordedRef}, latest ${latestRef}`,
      `    ${result.diffUrl}`,
    );
  }
  return lines.join("\n");
}

export function renderIssueBody(results, latest) {
  const drifted = driftedResults(results);
  const latestRef = latest.commit
    ? `[\`${latest.tag}\`](https://github.com/${UPSTREAM_REPO}/releases/tag/${latest.tag}) (\`${shortRef(latest.commit)}\`)`
    : `\`${latest.tag}\``;
  const rows = drifted.map((result) => {
    const recordedRef = `[\`${result.label ?? shortRef(result.commit)}\`](https://github.com/${UPSTREAM_REPO}/tree/${result.commit}/${result.upstreamPath}) (\`${shortRef(result.commit)}\`)`;
    return `| \`${result.file}\` | \`${result.upstreamPath}\` | ${STATUS_TEXT[result.status]} | ${recordedRef} | [diff](${result.diffUrl}) |`;
  });
  return [
    ISSUE_MARKER,
    `Files copied from [${UPSTREAM_REPO}](https://github.com/${UPSTREAM_REPO}) whose upstream source changed between the commit recorded in their header and the latest release, ${latestRef}.`,
    "",
    "| Local file | Upstream path | Status | Recorded | Diff |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Review each diff, port what applies, then update the header's commit and tag. This issue updates itself daily and closes when nothing drifts.",
    "",
  ].join("\n");
}

/**
 * Opens, updates, or closes the single drift issue. `github` is the client from createGitHubClient
 * (or a fake in tests). Returns what it did.
 */
export async function syncIssue({ results, latest, github }) {
  const drifted = driftedResults(results);
  const open = (await github.listOpenIssues(DRIFT_LABEL)).sort((a, b) => a.number - b.number);
  if (drifted.length === 0) {
    for (const issue of open) {
      await github.comment(issue.number, `No upstream drift against ${latest.tag}. Closing.`);
      await github.updateIssue(issue.number, { state: "closed", state_reason: "completed" });
    }
    return {
      action: open.length > 0 ? "closed" : "none",
      issues: open.map((issue) => issue.number),
    };
  }

  const title = issueTitle(latest.tag);
  const body = renderIssueBody(results, latest);
  const [primary, ...duplicates] = open;
  for (const duplicate of duplicates) {
    await github.comment(duplicate.number, `Superseded by #${primary.number}.`);
    await github.updateIssue(duplicate.number, { state: "closed", state_reason: "not_planned" });
  }
  if (primary) {
    if (primary.title === title && primary.body === body) {
      return { action: "unchanged", issues: [primary.number] };
    }
    await github.updateIssue(primary.number, { title, body });
    if (primary.title !== title) {
      await github.comment(
        primary.number,
        `Upstream released ${latest.tag}; the list above is current.`,
      );
    }
    return { action: "updated", issues: [primary.number] };
  }
  await github.ensureLabel(DRIFT_LABEL);
  const created = await github.createIssue({ title, body, labels: [DRIFT_LABEL] });
  return { action: "created", issues: [created.number] };
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "paseo-plugins-upstream-drift",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(url, { token, method = "GET", body } = {}) {
  const init = { method, headers: githubHeaders(token) };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export async function fetchLatestRelease({ token, repo = UPSTREAM_REPO, tag } = {}) {
  const tagName =
    tag ??
    (await requestJson(`https://api.github.com/repos/${repo}/releases/latest`, { token })).tag_name;
  const commit = await requestJson(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tagName)}`,
    { token },
  );
  return { tag: tagName, commit: commit.sha };
}

// Upstream is public, so raw reads go unauthenticated: the workflow's GITHUB_TOKEN is scoped to
// this repo and has no business on another repo's content host.
export function createRawFetcher({ repo = UPSTREAM_REPO } = {}) {
  return async (ref, upstreamPath) => {
    const encodedPath = upstreamPath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${encodedPath}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`raw ${ref}:${upstreamPath} failed: ${response.status}`);
    return response.text();
  };
}

export function createGitHubClient({ token, repo }) {
  const api = `https://api.github.com/repos/${repo}`;
  return {
    async listOpenIssues(label) {
      const issues = await requestJson(
        `${api}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
        { token },
      );
      return issues
        .filter((issue) => !issue.pull_request)
        .map(({ number, title, body }) => ({ number, title, body: body ?? "" }));
    },
    async ensureLabel(name) {
      try {
        await requestJson(`${api}/labels`, {
          token,
          method: "POST",
          body: {
            name,
            color: "d4c5f9",
            description: "Copied upstream Paseo files changed upstream",
          },
        });
      } catch (error) {
        if (error.status !== 422) throw error;
      }
    },
    createIssue(issue) {
      return requestJson(`${api}/issues`, { token, method: "POST", body: issue });
    },
    updateIssue(number, patch) {
      return requestJson(`${api}/issues/${number}`, { token, method: "PATCH", body: patch });
    },
    comment(number, body) {
      return requestJson(`${api}/issues/${number}/comments`, {
        token,
        method: "POST",
        body: { body },
      });
    },
  };
}

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    json: false,
    failOnDrift: false,
    latest: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--fail-on-drift") options.failOnDrift = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--latest" && argv[index + 1]) options.latest = argv[++index];
    else throw new Error(`Unknown argument: ${arg}\n\n${HELP_TEXT}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  const token = process.env.GITHUB_TOKEN || undefined;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!options.dryRun && (!token || !repo)) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required unless --dry-run is set");
  }

  const records = await collectRecords(REPO_ROOT);
  const latest = await fetchLatestRelease({ token, tag: options.latest });
  const results = await compareRecords(records, latest, createRawFetcher());

  if (options.json) console.log(JSON.stringify({ latest, results }, null, 2));
  else console.log(renderReport(results, latest));

  if (!options.dryRun) {
    const outcome = await syncIssue({
      results,
      latest,
      github: createGitHubClient({ token, repo }),
    });
    console.log(
      `Issue: ${outcome.action}${outcome.issues.length ? ` (#${outcome.issues.join(", #")})` : ""}`,
    );
  }
  return options.failOnDrift && driftedResults(results).length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
