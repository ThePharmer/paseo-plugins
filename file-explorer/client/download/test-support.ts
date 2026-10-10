// Test-only helpers. Client code typechecks without Node, so tests cannot use Buffer.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALPHABET_CODES = Uint8Array.from(ALPHABET, (char) => char.charCodeAt(0));
const PADDING_CODE = "=".charCodeAt(0);

/** Reference base64 encoder for building fake chunk responses. */
export function encodeBase64(bytes: Uint8Array): string {
  const codes = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let out = 0;
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const triple = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    codes[out++] = ALPHABET_CODES[(triple >> 18) & 63];
    codes[out++] = ALPHABET_CODES[(triple >> 12) & 63];
    codes[out++] = remaining > 1 ? ALPHABET_CODES[(triple >> 6) & 63] : PADDING_CODE;
    codes[out++] = remaining > 2 ? ALPHABET_CODES[triple & 63] : PADDING_CODE;
  }
  const parts: string[] = [];
  for (let start = 0; start < codes.length; start += 8192) {
    parts.push(String.fromCharCode(...codes.subarray(start, start + 8192)));
  }
  return parts.join("");
}

/** Byte equality without the per-element cost of a deep-equal matcher on megabyte arrays. */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
