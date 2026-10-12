// Pure helpers for plugin releases, shared by release-check.mjs and release-publish.mjs.
//
// Each plugin keeps a CHANGELOG.md in the upstream getpaseo/paseo format:
//
//   # Changelog
//
//   ## Unreleased            (optional, always first)
//
//   ## 0.1.0 - 2026-10-12
//
//   ### Added
//
//   - Added X ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
//
// The version in the plugin's package.json must match the top released entry. A release is the
// tag <plugin>/v<version> plus a GitHub Release whose body is that entry.

export const DEFAULT_REPO = "ThePharmer/paseo-plugins";
export const UNRELEASED = "Unreleased";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ENTRY_HEADING_PATTERN = /^##(?!#)/;
const RELEASED_HEADING_PATTERN = /^## (\S+) - (\S+)$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

/** @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null} */
export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(String(version));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function isSemver(version) {
  return parseSemver(version) !== null;
}

export function isPrerelease(version) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Not a semver version: ${version}`);
  return parsed.prerelease.length > 0;
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Semver precedence: -1, 0 or 1. Build metadata is ignored. Throws on invalid versions. */
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left) throw new Error(`Not a semver version: ${a}`);
  if (!right) throw new Error(`Not a semver version: ${b}`);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const order = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (order !== 0) return order;
  }
  return 0;
}

function isCalendarDate(text) {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Splits a changelog into `## ` sections, skipping headings inside fenced code blocks. */
function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE_PATTERN.test(line)) inFence = !inFence;
    if (!inFence && ENTRY_HEADING_PATTERN.test(line)) {
      sections.push({ heading: line.trimEnd(), line: index + 1, lines: [] });
    } else if (sections.length > 0) {
      sections.at(-1).lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

function headingProblem(heading) {
  if (heading === `## ${UNRELEASED}`) return { version: UNRELEASED, date: null };
  const match = RELEASED_HEADING_PATTERN.exec(heading);
  if (!match) {
    return {
      error: `malformed heading "${heading}"; expected "## X.Y.Z - YYYY-MM-DD" or "## ${UNRELEASED}"`,
    };
  }
  const [, version, date] = match;
  if (!isSemver(version)) return { error: `"${version}" is not a semver version (no leading v)` };
  if (!isCalendarDate(date)) return { error: `date "${date}" for ${version} is not YYYY-MM-DD` };
  return { version, date };
}

/**
 * Parses a CHANGELOG.md. Throws one Error listing every problem found.
 * @returns {{ version: string, date: string | null, body: string }[]} newest first
 */
export function parseChangelog(text) {
  const { preamble, sections } = splitSections(text);
  const errors = [];
  if (trimBlankLines(preamble)[0]?.trimEnd() !== "# Changelog") {
    errors.push('the first line must be "# Changelog"');
  }
  const entries = [];
  const seen = new Set();
  for (const section of sections) {
    const parsed = headingProblem(section.heading);
    if (parsed.error) {
      errors.push(`line ${section.line}: ${parsed.error}`);
      continue;
    }
    const { version, date } = parsed;
    if (seen.has(version)) {
      errors.push(`line ${section.line}: duplicate entry for ${version}`);
      continue;
    }
    if (version === UNRELEASED && entries.length > 0) {
      errors.push(`line ${section.line}: "## ${UNRELEASED}" must be the first entry`);
    }
    const body = trimBlankLines(section.lines).join("\n");
    if (version !== UNRELEASED && body === "") {
      errors.push(`line ${section.line}: ${version} has no notes`);
    }
    const previous = entries.findLast((entry) => entry.version !== UNRELEASED);
    if (
      version !== UNRELEASED &&
      previous &&
      isSemver(previous.version) &&
      compareSemver(version, previous.version) >= 0
    ) {
      errors.push(
        `line ${section.line}: ${version} is listed below ${previous.version}; newest goes first`,
      );
    }
    seen.add(version);
    entries.push({ version, date, body });
  }
  if (errors.length > 0) throw new Error(`Invalid changelog:\n- ${errors.join("\n- ")}`);
  return entries;
}

/** The first entry that is not Unreleased, or null. */
export function latestRelease(entries) {
  return entries.find((entry) => entry.version !== UNRELEASED) ?? null;
}

/** The body of a version's entry, without its `## ` heading. Throws when missing. */
export function releaseNotes(text, version) {
  const entry = parseChangelog(text).find((candidate) => candidate.version === version);
  if (!entry) throw new Error(`CHANGELOG.md has no "## ${version} - YYYY-MM-DD" entry`);
  return entry.body;
}

/** Changelog text with the Unreleased section removed, for "did released notes change?". */
export function withoutUnreleased(text) {
  const { preamble, sections } = splitSections(text);
  const kept = sections.filter((section) => section.heading !== `## ${UNRELEASED}`);
  const lines = [...preamble];
  for (const section of kept) lines.push(section.heading, ...section.lines);
  return trimBlankLines(lines.map((line) => line.trimEnd())).join("\n");
}

export function tagName(plugin, version) {
  if (!plugin || /[\s/]/.test(plugin)) throw new Error(`Invalid plugin name: "${plugin}"`);
  if (!isSemver(version)) throw new Error(`Not a semver version: ${version}`);
  return `${plugin}/v${version}`;
}

/**
 * Checks one plugin. `base` is null without a base ref; otherwise it holds the plugin's
 * package.json version and CHANGELOG.md text at the base, each null when absent there.
 * @returns {string[]} problems; empty when the plugin is fine
 */
export function checkPlugin({ plugin, version, changelogText, base = null }) {
  if (changelogText === null || changelogText === undefined) {
    return [`${plugin}/CHANGELOG.md is missing; add one with a "## ${version} - YYYY-MM-DD" entry`];
  }
  let entries;
  try {
    entries = parseChangelog(changelogText);
  } catch (error) {
    return [`${plugin}/CHANGELOG.md: ${error.message}`];
  }
  if (!isSemver(version)) return [`${plugin}/package.json version "${version}" is not semver`];

  const errors = [];
  const top = latestRelease(entries);
  if (!top) {
    errors.push(
      `${plugin}/CHANGELOG.md has no released entry; add "## ${version} - YYYY-MM-DD" for the package.json version`,
    );
  } else if (top.version !== version) {
    errors.push(
      `${plugin}: the top released CHANGELOG.md entry is ${top.version} but package.json says ${version}; they must match`,
    );
  }
  if (!base || base.version === null || base.version === undefined) return errors;

  if (base.version !== version) {
    if (isSemver(base.version) && compareSemver(version, base.version) <= 0) {
      errors.push(
        `${plugin}: version went from ${base.version} to ${version}; a new version must be greater`,
      );
    }
    return errors;
  }
  const releasedChanged =
    base.changelogText === null || base.changelogText === undefined
      ? true
      : withoutUnreleased(base.changelogText) !== withoutUnreleased(changelogText);
  if (releasedChanged) {
    errors.push(
      `${plugin}: CHANGELOG.md changed but package.json version is still ${version}. Bump the ` +
        `version (npm version <patch|minor|major> --no-git-tag-version in ${plugin}/) and add a ` +
        `"## <new version> - YYYY-MM-DD" entry, or move the notes under "## ${UNRELEASED}".`,
    );
  }
  return errors;
}

/** Tag names from `git ls-remote --tags` output. */
export function parseLsRemoteTags(output) {
  const tags = new Set();
  for (const line of output.split(/\r?\n/)) {
    const ref = line.split("\t")[1];
    if (!ref?.startsWith("refs/tags/")) continue;
    tags.add(ref.slice("refs/tags/".length).replace(/\^\{\}$/, ""));
  }
  return tags;
}

export function installCommand({ repo = DEFAULT_REPO, plugin, tag }) {
  return `paseo plugin install git:${repo}:${plugin} --ref ${tag}`;
}

export function releaseTitle(plugin, version) {
  return `${plugin} ${version}`;
}

export function releaseBody({ notes, repo = DEFAULT_REPO, plugin, tag }) {
  return [
    notes.trim(),
    "",
    "### Install",
    "",
    "```bash",
    installCommand({ repo, plugin, tag }),
    "```",
    "",
  ].join("\n");
}
