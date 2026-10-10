// Randomized containment checks for the explorer RPCs. Every generated path is hostile in some
// way; the property is that a successful result only ever describes something inside the allowed
// root and that no result ever carries the bytes of a file planted outside it.
//
// Deterministic by default. A failure prints the seed and shrink path; replay it with
// FILE_EXPLORER_FC_SEED=<seed> (and FILE_EXPLORER_FC_PATH=<path>) npx vitest run <this file>.

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fc from "fast-check";
import type { PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { explorerSettings } from "../shared/settings";
import { createExplorerHandlers, type ExplorerHandlers } from "./handlers";

type Schema = (typeof explorerSettings)["schema"];

const isWindows = process.platform === "win32";
const SEED = Number(process.env.FILE_EXPLORER_FC_SEED ?? 20251010);
const REPLAY_PATH = process.env.FILE_EXPLORER_FC_PATH;
const NUM_RUNS = 3000;
const SECRET = `SECRET-${"f".repeat(8)}-must-never-be-read`;
const TEST_TIMEOUT_MS = 60_000;

interface Tree {
  sandbox: string;
  /** Configured allowed folder, already canonical. */
  root: string;
  /** Configured allowed folder reached through a symlink (POSIX only). */
  linkedRoot: string | null;
  outside: string;
  /** Shares the root's name as a prefix, the classic startsWith() escape. */
  prefixSibling: string;
  fakeHome: string;
}

let tree: Tree;
let handlers: ExplorerHandlers;
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

function settingsFor(folders: string[]): PluginSettings<Schema> {
  const state: PluginSettingsState<Schema> = {
    status: "ready",
    revision: "1",
    values: { folders: folders.map((folder) => ({ path: folder })) },
  };
  return { read: async () => state, subscribe: () => () => {} };
}

async function plantSecret(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "secret.txt"), `${SECRET}\n`);
}

async function buildTree(): Promise<Tree> {
  const sandbox = await realpath(await mkdtemp(path.join(os.tmpdir(), "file-explorer-fc-")));
  const root = path.join(sandbox, "allowed");
  const outside = path.join(sandbox, "outside");
  const prefixSibling = `${root}-sibling`;
  const fakeHome = path.join(sandbox, "home");

  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await mkdir(path.join(root, "~"), { recursive: true });
  await mkdir(path.join(root, "...dir"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "inside: index\n");
  await writeFile(path.join(root, "src", "deep", "leaf.txt"), "inside: leaf\n");
  await writeFile(path.join(root, "~", "tilde.txt"), "inside: tilde\n");
  await writeFile(path.join(root, "..notes.txt"), "inside: notes\n");
  await writeFile(path.join(root, "...dir", "x.txt"), "inside: dots\n");
  await plantSecret(outside);
  await plantSecret(prefixSibling);
  await plantSecret(fakeHome);
  await plantSecret(path.join(sandbox));

  let linkedRoot: string | null = null;
  if (!isWindows) {
    // Links that stay inside.
    await symlink(path.join(root, "src", "index.ts"), path.join(root, "inside-link.ts"));
    await symlink("src/deep", path.join(root, "nested-link"));
    await symlink(path.join(root, "nested-link"), path.join(root, "nested-link-2"));
    // Links that escape, absolute and relative, to files and directories.
    await symlink(path.join(outside, "secret.txt"), path.join(root, "secret-link.txt"));
    await symlink("../outside/secret.txt", path.join(root, "src", "relative-secret-link.txt"));
    await symlink(outside, path.join(root, "out-dir-link"));
    await symlink("..", path.join(root, "up-link"));
    await symlink(prefixSibling, path.join(root, "src", "deep", "sibling-link"));
    await symlink(path.join(root, "out-dir-link", "secret.txt"), path.join(root, "chain-link"));
    await symlink(fakeHome, path.join(root, "~", "home-link"));
    await symlink(path.join(root, "missing-target"), path.join(root, "dangling-link"));
    await symlink("loop-b", path.join(root, "loop-a"));
    await symlink("loop-a", path.join(root, "loop-b"));
    linkedRoot = path.join(sandbox, "root-link");
    await symlink(root, linkedRoot);
  }

  return { sandbox, root, linkedRoot, outside, prefixSibling, fakeHome };
}

// The native realpath, like fs.promises.realpath in the service, so Windows 8.3 short names in
// the temp directory expand the same way on both sides.
function canonical(target: string): string {
  return realpathSync.native(target);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Where the service would have opened `requested` for `configuredRoot`, canonicalized. */
function canonicalTarget(configuredRoot: string, requested: string): string {
  const lexical = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(configuredRoot, requested);
  return canonical(lexical);
}

const SEGMENTS = [
  "..",
  ".",
  "~",
  "~root",
  "~user",
  "",
  "...",
  "..notes.txt",
  "...dir",
  "src",
  "deep",
  "index.ts",
  "leaf.txt",
  "secret.txt",
  "x.txt",
  "tilde.txt",
  "allowed",
  "allowed-sibling",
  "outside",
  "home",
  "root-link",
  "inside-link.ts",
  "nested-link",
  "nested-link-2",
  "secret-link.txt",
  "relative-secret-link.txt",
  "out-dir-link",
  "up-link",
  "sibling-link",
  "chain-link",
  "home-link",
  "dangling-link",
  "loop-a",
  "%2e%2e",
  "%2e%2e%2f",
  "..%2f",
  "%2F",
  "..%5c",
  "..\\",
  "\\..\\",
  "..\\..",
  "C:",
  "C:\\",
  "c:/",
  "\\\\server\\share",
  "\\\\?\\C:\\",
  "//server/share",
  "a\0b",
  "\0",
  "secret.txt\0.png",
  "\u202e",
  "\uff0e\uff0e",
  "..\u2215",
  "\u2025",
  "ü",
  "名前",
  "x".repeat(300),
  "y".repeat(5000),
  "foo.",
  "foo ",
  "src.",
  "src ",
  "CON",
  "NUL",
  "aux.txt",
];

const segment = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...SEGMENTS) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 6 }) },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 4 }) },
);
const separator = fc.constantFrom("/", "/", "\\", "//", "/./");
const trailing = fc.constantFrom("", "", "/", "\\", ".", "/.", "/..", "//", " ");

const relativePath = fc
  .tuple(fc.array(fc.tuple(segment, separator), { minLength: 0, maxLength: 7 }), segment, trailing)
  .map(([parts, last, tail]) => parts.map(([name, sep]) => name + sep).join("") + last + tail);

// Short walks over names that exist, so a good share of requests succeed and the symlinks get
// combined with ".." in ways the purely hostile generator rarely reaches.
const treeWalk = fc
  .array(
    fc.constantFrom(
      "src",
      "deep",
      "..",
      ".",
      "~",
      "...dir",
      "nested-link",
      "nested-link-2",
      "up-link",
      "out-dir-link",
      "sibling-link",
      "home-link",
      "allowed",
      "outside",
      "secret.txt",
      "index.ts",
      "leaf.txt",
      "tilde.txt",
      "x.txt",
      "..notes.txt",
      "inside-link.ts",
      "secret-link.txt",
      "relative-secret-link.txt",
      "chain-link",
    ),
    { minLength: 1, maxLength: 5 },
  )
  .chain((names) => separator.map((sep) => names.join(sep)));

function absolutePath(): fc.Arbitrary<string> {
  const bases = [
    tree.root,
    tree.outside,
    tree.prefixSibling,
    tree.sandbox,
    tree.fakeHome,
    path.parse(tree.root).root,
    ...(tree.linkedRoot ? [tree.linkedRoot] : []),
    ...(isWindows ? ["C:\\", "C:", "\\\\server\\share\\", "\\\\?\\C:\\", "\\\\.\\C:\\"] : []),
  ];
  return fc
    .tuple(fc.constantFrom(...bases), separator, fc.oneof(relativePath, treeWalk))
    .map(([base, sep, rest]) => base + sep + rest);
}

describe("path containment (randomized)", () => {
  beforeAll(async () => {
    tree = await buildTree();
    process.env.HOME = tree.fakeHome;
    process.env.USERPROFILE = tree.fakeHome;
    handlers = createExplorerHandlers(
      settingsFor([tree.root, ...(tree.linkedRoot ? [tree.linkedRoot] : [])]),
    );
  });

  afterAll(async () => {
    process.env.HOME = savedEnv.HOME;
    process.env.USERPROFILE = savedEnv.USERPROFILE;
    if (savedEnv.HOME === undefined) delete process.env.HOME;
    if (savedEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
    if (tree) await rm(tree.sandbox, { recursive: true, force: true });
  });

  it(
    "never returns anything outside the allowed root",
    async () => {
      const canonicalRoot = canonical(tree.root);
      const roots = [tree.root, ...(tree.linkedRoot ? [tree.linkedRoot] : [])];
      const ok = { listDirectory: 0, readFile: 0, readFileChunk: 0 };

      const property = fc.asyncProperty(
        fc.constantFrom(...roots),
        fc.oneof(
          { weight: 3, arbitrary: relativePath },
          { weight: 3, arbitrary: treeWalk },
          { weight: 2, arbitrary: absolutePath() },
        ),
        async (root, requested) => {
          const listing = await handlers.listDirectory({ root, path: requested });
          if (listing.status === "ok") {
            ok.listDirectory += 1;
            expect(
              isInside(canonicalRoot, canonicalTarget(root, requested)),
              `listDirectory escaped with ${JSON.stringify(requested)}`,
            ).toBe(true);
            for (const entry of listing.directory.entries) {
              const target = canonical(path.resolve(root, listing.directory.path, entry.name));
              expect(
                isInside(canonicalRoot, target),
                `listDirectory(${JSON.stringify(requested)}) exposed ${entry.path} -> ${target}`,
              ).toBe(true);
            }
          }

          const file = await handlers.readFile({ root, path: requested });
          if (file.status === "ok") {
            ok.readFile += 1;
            expect(isInside(canonicalRoot, canonicalTarget(root, requested))).toBe(true);
            expect(file.file.content ?? "").not.toContain(SECRET);
          }

          const chunk = await handlers.readFileChunk({
            root,
            path: requested,
            offset: 0,
            length: 4096,
          });
          if (chunk.status === "ok") {
            ok.readFileChunk += 1;
            expect(isInside(canonicalRoot, canonicalTarget(root, requested))).toBe(true);
            expect(Buffer.from(chunk.base64, "base64").toString("utf8")).not.toContain(SECRET);
          }
        },
      );

      await fc.assert(property, {
        seed: SEED,
        numRuns: REPLAY_PATH ? 1 : NUM_RUNS,
        path: REPLAY_PATH,
      });

      // Guard against a vacuous run where every generated path is simply rejected.
      expect(ok.listDirectory).toBeGreaterThan(0);
      expect(ok.readFile).toBeGreaterThan(0);
      expect(ok.readFileChunk).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it("refuses every root that is not configured verbatim", async () => {
    const hostileRoot = fc.oneof(
      fc.constantFrom(
        tree.outside,
        tree.prefixSibling,
        tree.sandbox,
        tree.fakeHome,
        "~",
        "~/",
        `${tree.root}/`,
        `${tree.root}/.`,
        `${tree.root}/../allowed`,
        `${tree.root}\\`,
        tree.root.toUpperCase(),
        ` ${tree.root}`,
        `${tree.root}\0`,
      ),
      fc
        .tuple(fc.constantFrom(tree.root, tree.sandbox), separator, relativePath)
        .map(([base, sep, rest]) => base + sep + rest),
    );
    const configured = new Set([tree.root, ...(tree.linkedRoot ? [tree.linkedRoot] : [])]);

    await fc.assert(
      fc.asyncProperty(hostileRoot, async (root) => {
        fc.pre(!configured.has(root));
        const results = [
          await handlers.listDirectory({ root }),
          await handlers.readFile({ root, path: "secret.txt" }),
          await handlers.readFileChunk({ root, path: "secret.txt", offset: 0, length: 64 }),
        ];
        for (const result of results) {
          expect(result).toEqual({
            status: "error",
            error: "Folder is not in the allowed folders list",
          });
        }
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});
