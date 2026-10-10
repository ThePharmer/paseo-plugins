import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "./file-name";

describe("sanitizeFileName", () => {
  it("keeps ordinary names unchanged", () => {
    expect(sanitizeFileName("report final.pdf")).toBe("report final.pdf");
    expect(sanitizeFileName(".env")).toBe(".env");
  });

  it("replaces path separators and reserved characters", () => {
    expect(sanitizeFileName("../etc/passwd")).toBe(".._etc_passwd");
    expect(sanitizeFileName("a\\b:c*d?.txt")).toBe("a_b_c_d_.txt");
  });

  it("strips control characters and falls back for empty or dot-only names", () => {
    expect(sanitizeFileName("a\u0000b\n.txt")).toBe("ab.txt");
    expect(sanitizeFileName("   ")).toBe("download");
    expect(sanitizeFileName("..")).toBe("download");
    expect(sanitizeFileName("\u0001")).toBe("download");
  });

  it("caps long names but keeps the extension", () => {
    const sanitized = sanitizeFileName(`${"x".repeat(300)}.png`);
    expect(sanitized.length).toBe(120);
    expect(sanitized.endsWith(".png")).toBe(true);
  });
});
