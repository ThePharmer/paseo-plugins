// Pure-JS base64 decoding. Hermes and browsers both have `atob`, but it returns a binary string
// that still needs a byte loop, and the plugin typechecks without the DOM library. One decoder keeps
// web and native on the same tested path.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PADDING = "=".charCodeAt(0);
const INVALID = 255;

const SEXTETS = buildSextetTable();

function buildSextetTable(): Uint8Array {
  const table = new Uint8Array(128).fill(INVALID);
  for (let index = 0; index < ALPHABET.length; index += 1) {
    table[ALPHABET.charCodeAt(index)] = index;
  }
  return table;
}

export class InvalidBase64Error extends Error {
  constructor(readonly position: number) {
    super(`Invalid base64 data at position ${position}`);
    this.name = "InvalidBase64Error";
  }
}

/** Decoded size of padded base64, without decoding it. */
export function base64ByteLength(base64: string): number {
  if (base64.length % 4 !== 0) {
    throw new InvalidBase64Error(base64.length);
  }
  let padding = 0;
  if (base64.endsWith("==")) {
    padding = 2;
  } else if (base64.endsWith("=")) {
    padding = 1;
  }
  return (base64.length / 4) * 3 - padding;
}

/** Decodes padded standard base64, the format Node's Buffer#toString("base64") produces. */
export function decodeBase64(base64: string): Uint8Array {
  const byteLength = base64ByteLength(base64);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  for (let position = 0; position < base64.length; position += 4) {
    const triple =
      (sextetAt(base64, position) << 18) |
      (sextetAt(base64, position + 1) << 12) |
      (sextetAt(base64, position + 2) << 6) |
      sextetAt(base64, position + 3);
    bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = triple & 0xff;
  }
  return bytes;
}

function sextetAt(base64: string, position: number): number {
  const code = base64.charCodeAt(position);
  // Padding only appears in the last two positions; base64ByteLength already counted it.
  if (code === PADDING && position >= base64.length - 2) return 0;
  const sextet = code < 128 ? SEXTETS[code] : INVALID;
  if (sextet === INVALID) {
    throw new InvalidBase64Error(position);
  }
  return sextet;
}
