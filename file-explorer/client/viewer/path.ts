/** The last segment of a "/"-separated relative path. */
export function fileNameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return name === "" ? path : name;
}

/**
 * The absolute path shown and copied for a file: the allowed-folder root joined with the
 * relative path, using the root's own separator so Windows roots stay readable.
 */
export function absolutePathOf(root: string, path: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const relative = path.replace(/^\/+/, "").split("/").filter(Boolean).join(separator);
  if (relative === "") return root;
  const base = root.endsWith(separator) ? root.slice(0, -1) : root;
  return `${base}${separator}${relative}`;
}

// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/file-pane/bar.tsx (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
