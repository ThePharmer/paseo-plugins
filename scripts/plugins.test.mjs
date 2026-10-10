import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listPlugins } from "./plugins.mjs";

test("lists top-level directories that have a paseo-plugin.json, sorted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugins-test-"));
  try {
    for (const name of ["zeta", "alpha", "e2e", ".hidden", "scripts"]) {
      await mkdir(path.join(dir, name));
    }
    for (const name of ["zeta", "alpha", ".hidden"]) {
      await writeFile(path.join(dir, name, "paseo-plugin.json"), "{}");
    }
    await writeFile(path.join(dir, "e2e", "package.json"), "{}");

    assert.deepEqual(listPlugins(dir), ["alpha", "zeta"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finds the plugins in this repo", () => {
  assert.ok(listPlugins().includes("file-explorer"));
});
