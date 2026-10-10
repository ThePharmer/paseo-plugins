// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/server/src/server/path-utils.ts (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: only the helpers the explorer service uses.

import { homedir } from "node:os";
import { resolve } from "node:path";

function hasHomePrefix(value: string): boolean {
  return value === "~" || value.startsWith("~/");
}

export function expandUserPath(value: string): string {
  const trimmed = value.trim();
  if (hasHomePrefix(trimmed)) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}
