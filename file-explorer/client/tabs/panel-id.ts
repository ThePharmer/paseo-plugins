// Per-file workspace panel IDs. The app persists a plugin tab by (pluginId, panelId), so the ID
// must be a pure function of the file: the same file always maps to the same tab, across reloads
// and clients. Panel IDs must match /^[a-z][a-z0-9-]*$/, which rules out using the path itself.

const FILE_PANEL_PREFIX = "f-";
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
// Base36 width of the largest 32-bit value ("1z141z3"); padding keeps every ID the same length.
const HALF_WIDTH = 7;

export interface FileRef {
  root: string;
  path: string;
}

export function fileKey({ root, path }: FileRef): string {
  return `${root}\n${path}`;
}

/**
 * "f-" plus two 32-bit FNV-1a hashes of the UTF-8 key, one over the bytes forward and one
 * backward. A collision needs both to collide at once, which is out of reach for the 20 files
 * the tab list keeps.
 */
export function filePanelId(file: FileRef): string {
  const bytes = utf8Bytes(fileKey(file));
  const forward = fnv1a(bytes);
  const backward = fnv1a(bytes.slice().reverse());
  return `${FILE_PANEL_PREFIX}${toFixedBase36(forward)}${toFixedBase36(backward)}`;
}

function fnv1a(bytes: readonly number[]): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function toFixedBase36(value: number): string {
  return value.toString(36).padStart(HALF_WIDTH, "0");
}

// TextEncoder is not guaranteed on every React Native engine the app ships, so encode by hand.
function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}
