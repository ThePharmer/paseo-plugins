import type { AllowedFolderSetting } from "../../shared/settings";

// The daemon resolves a relative path against its own working directory, which is never what
// the user meant, so only absolute, home-relative and Windows drive paths are accepted.

export type FolderDraftResult =
  | { status: "valid"; folder: AllowedFolderSetting }
  | { status: "invalid"; error: string };

interface ValidateFolderDraftInput {
  path: string;
  label: string;
  existing: readonly AllowedFolderSetting[];
}

export function isAcceptedFolderPath(path: string): boolean {
  return (
    path.startsWith("/") || path === "~" || path.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(path)
  );
}

export function validateFolderDraft({
  path,
  label,
  existing,
}: ValidateFolderDraftInput): FolderDraftResult {
  const trimmedPath = path.trim();
  if (!trimmedPath) return { status: "invalid", error: "Enter a folder path" };
  if (!isAcceptedFolderPath(trimmedPath)) {
    return {
      status: "invalid",
      error: "Use an absolute path, a path starting with ~/, or a drive path such as C:\\",
    };
  }
  const normalized = normalizeForComparison(trimmedPath);
  if (existing.some((folder) => normalizeForComparison(folder.path) === normalized)) {
    return { status: "invalid", error: "This folder is already allowed" };
  }
  const trimmedLabel = label.trim();
  const folder: AllowedFolderSetting = trimmedLabel
    ? { path: trimmedPath, label: trimmedLabel }
    : { path: trimmedPath };
  return { status: "valid", folder };
}

// Trailing separators are the common way to type the same folder twice; the daemon dedupes the
// rest after expanding ~.
function normalizeForComparison(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/" || /^[A-Za-z]:[\\/]$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

// Matches by path rather than index so a list that changed since the row rendered still updates
// the right folder. An empty label falls back to the folder name, as it does when adding.
export function relabelFolder(
  folders: readonly AllowedFolderSetting[],
  path: string,
  label: string,
): AllowedFolderSetting[] {
  const trimmed = label.trim();
  return folders.map((folder) => {
    if (folder.path !== path) return folder;
    return trimmed ? { path: folder.path, label: trimmed } : { path: folder.path };
  });
}
