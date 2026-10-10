// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/utils/explorer-paths.ts and packages/app/src/utils/path.ts (Apache-2.0,
// Copyright (c) 2025-present Mohamed Boudra).
// Modified: the workspace root is an allowed-folder root; added basename for tab and screen titles.

interface BuildAbsoluteExplorerPathInput {
  root: string;
  entryPath: string;
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

export function buildAbsoluteExplorerPath({
  root,
  entryPath,
}: BuildAbsoluteExplorerPathInput): string {
  const normalizedRoot = root.trim().replace(/[\\/]+$/, "");
  const normalizedEntryPath = entryPath.trim();

  if (!normalizedRoot) {
    return normalizedEntryPath;
  }

  if (!normalizedEntryPath || normalizedEntryPath === ".") {
    return normalizedRoot;
  }

  if (isAbsolutePath(normalizedEntryPath)) {
    return normalizedEntryPath;
  }

  // A Windows root keeps its own separator so the copied path pastes into Explorer or a shell.
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  const segments = normalizedEntryPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return normalizedRoot;
  }

  return `${normalizedRoot}${separator}${segments.join(separator)}`;
}

export function explorerBasename(entryPath: string): string {
  const segments = entryPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? entryPath;
}
