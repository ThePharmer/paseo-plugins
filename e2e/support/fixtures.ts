import { randomBytes } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

export interface FixtureTree {
  /** Allowed folder with the files the tests read. */
  allowed: string;
  /** Configured as allowed but never created. */
  missing: string;
  /** Sibling of `allowed` that must stay unreachable. */
  outside: string;
  secret: string;
  /** Plain directory registered as a Paseo project, for the Explorer dock flow. */
  project: string;
  /** False on Windows, where creating symlinks needs extra privileges. */
  hasEscapeLink: boolean;
}

export const NOTES_MD = "# Weekly notes\n\n- Ship the file explorer\n- Write the e2e suite\n";
export const INDEX_TS =
  "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n";
export const CONFIG_JSON = '{\n  "name": "fixture",\n  "enabled": true\n}\n';
export const ENV_EXAMPLE = "API_URL=http://localhost:3000\n";
export const BLOB_BYTES = 300 * 1024;

/** Root listing the plugin should return: the dotfile is shown, the escaping symlink is not. */
export const ROOT_ENTRY_NAMES = [
  ".env.example",
  "blob.bin",
  "docs",
  "notes.md",
  "src",
  "swatch.png",
];

export async function seedFixtures(base: string): Promise<FixtureTree> {
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  const project = path.join(base, "project");
  const secret = path.join(outside, "secret.txt");
  await mkdir(path.join(allowed, "src"), { recursive: true });
  await mkdir(path.join(allowed, "docs"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(project, { recursive: true });

  await writeFile(path.join(allowed, "notes.md"), NOTES_MD);
  await writeFile(path.join(allowed, "src", "index.ts"), INDEX_TS);
  await writeFile(path.join(allowed, "docs", "config.json"), CONFIG_JSON);
  await writeFile(path.join(allowed, ".env.example"), ENV_EXAMPLE);
  await writeFile(path.join(allowed, "swatch.png"), solidPng(16, 16, [0x2f, 0x80, 0xed]));
  await writeFile(path.join(allowed, "blob.bin"), randomBytes(BLOB_BYTES));
  await writeFile(secret, "top secret\n");
  await writeFile(path.join(project, "README.md"), "# Fixture project\n");

  const hasEscapeLink = process.platform !== "win32";
  if (hasEscapeLink) await symlink(secret, path.join(allowed, "escape-link.txt"));

  return { allowed, missing: path.join(base, "missing"), outside, secret, project, hasEscapeLink };
}

// A real PNG without an image library: one IDAT of unfiltered RGB rows.
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit depth, truecolor, default compression/filter/interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
