#!/usr/bin/env node
// Installs the Paseo CLI (which ships the daemon and its bundled web UI) at the version named by
// PASEO_VERSION, together with the matching @getpaseo/client and @getpaseo/plugin the tests
// import. Without PASEO_VERSION it keeps the version pinned in package-lock.json.
//
//   PASEO_VERSION=latest npm run install:paseo
//   PASEO_VERSION=0.11.1 npm run install:paseo
//
// The install uses --no-save, so package.json and package-lock.json stay pinned to the floor
// version. Run `npm ci` to go back to it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["@getpaseo/cli", "@getpaseo/client", "@getpaseo/plugin"];
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function npmOut(args) {
  return execFileSync(npm, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
}

// Read the top-level copy directly: some of these packages have an exports map without
// "./package.json", so require.resolve cannot reach it.
function installedVersion(name) {
  try {
    const manifest = path.join(root, "node_modules", ...name.split("/"), "package.json");
    return JSON.parse(readFileSync(manifest, "utf8")).version;
  } catch {
    return null;
  }
}

const requested = process.env.PASEO_VERSION?.trim();
if (!requested) {
  console.log(`PASEO_VERSION not set; keeping @getpaseo/cli ${installedVersion("@getpaseo/cli")}`);
  process.exit(0);
}

// Resolve dist-tags such as "latest" once, so all three packages land on the same release.
const version = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(requested)
  ? requested
  : npmOut(["view", `@getpaseo/cli@${requested}`, "version"])
      .split("\n")
      .pop()
      .replace(/'/g, "");

if (PACKAGES.every((name) => installedVersion(name) === version)) {
  console.log(`@getpaseo/cli ${version} already installed`);
  process.exit(0);
}

console.log(`Installing Paseo ${version} (requested ${requested})`);
execFileSync(
  npm,
  [
    "install",
    "--no-save",
    "--no-audit",
    "--no-fund",
    ...PACKAGES.map((name) => `${name}@${version}`),
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

const mismatched = PACKAGES.filter((name) => installedVersion(name) !== version);
if (mismatched.length > 0) {
  throw new Error(`Expected ${version} for ${mismatched.join(", ")} after install`);
}
