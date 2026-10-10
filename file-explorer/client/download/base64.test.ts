import { describe, expect, it } from "vitest";
import { base64ByteLength, decodeBase64, InvalidBase64Error } from "./base64";

// Client tests typecheck without Node types, so expected encodings are literals.
// RFC 4648 section 10 vectors cover every padding shape.
const RFC_VECTORS: readonly (readonly [string, string])[] = [
  ["", ""],
  ["f", "Zg=="],
  ["fo", "Zm8="],
  ["foo", "Zm9v"],
  ["foob", "Zm9vYg=="],
  ["fooba", "Zm9vYmE="],
  ["foobar", "Zm9vYmFy"],
];

// Bytes 0..255, from Buffer.from([0, ..., 255]).toString("base64").
const ALL_BYTES =
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

describe("decodeBase64", () => {
  it("decodes the RFC 4648 vectors", () => {
    for (const [plain, encoded] of RFC_VECTORS) {
      expect(base64ByteLength(encoded)).toBe(plain.length);
      expect(decodeBase64(encoded)).toEqual(asciiBytes(plain));
    }
  });

  it("decodes every byte value", () => {
    const expected = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(base64ByteLength(ALL_BYTES)).toBe(256);
    expect(decodeBase64(ALL_BYTES)).toEqual(expected);
  });

  it("rejects unpadded, non-alphabet, and misplaced padding input", () => {
    expect(() => decodeBase64("abc")).toThrow(InvalidBase64Error);
    expect(() => decodeBase64("ab$d")).toThrow(InvalidBase64Error);
    expect(() => decodeBase64("a=bc")).toThrow(InvalidBase64Error);
    expect(() => decodeBase64("abéd")).toThrow(InvalidBase64Error);
  });
});
