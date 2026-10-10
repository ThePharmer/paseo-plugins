// Partly ported from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/stores/download-store.ts (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: also strips control characters, rejects dot-only names, and caps the length while
// keeping the extension.

const FALLBACK_NAME = "download";
// Most filesystems cap a name at 255 bytes; stay well under it for multi-byte names.
const MAX_NAME_LENGTH = 120;

/**
 * A file name that is safe as one path segment on iOS and Android. The extension survives
 * because iOS picks the share sheet's file type from it.
 */
export function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  if (cleaned === "" || /^\.+$/.test(cleaned)) {
    return FALLBACK_NAME;
  }
  if (cleaned.length <= MAX_NAME_LENGTH) {
    return cleaned;
  }
  const extension = extensionOf(cleaned);
  return cleaned.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}

function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension. Very long "extensions" are not worth keeping.
  if (lastDot <= 0 || fileName.length - lastDot > 16) {
    return "";
  }
  return fileName.slice(lastDot);
}
