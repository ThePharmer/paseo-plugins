import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";
import { describe, expect, it } from "vitest";
import {
  colorSchemeForTheme,
  createTokenStyles,
  parseColor,
  relativeLuminance,
  tokenStyleFor,
} from "./syntax";

describe("parseColor", () => {
  it("reads hex and rgb() colors", () => {
    expect(parseColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#18181B")).toEqual({ r: 24, g: 24, b: 27 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseColor("#000000cc")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor("rgba(10 20 30 / 0.5)")).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("returns null for colors it does not understand", () => {
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("spans black to white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
  });
});

describe("colorSchemeForTheme", () => {
  it("follows the surface of Paseo's built-in themes", () => {
    expect(colorSchemeForTheme({ surface0: "#ffffff", foreground: "#09090b" })).toBe("light");
    expect(colorSchemeForTheme({ surface0: "#18181b", foreground: "#fafafa" })).toBe("dark");
    expect(colorSchemeForTheme({ surface0: "#282c34", foreground: "#abb2bf" })).toBe("dark");
  });

  it("falls back to the foreground, then dark", () => {
    expect(colorSchemeForTheme({ surface0: "canvas", foreground: "#111111" })).toBe("light");
    expect(colorSchemeForTheme({ surface0: "canvas", foreground: "#eeeeee" })).toBe("dark");
    expect(colorSchemeForTheme({ surface0: "canvas", foreground: "ink" })).toBe("dark");
  });
});

describe("createTokenStyles", () => {
  it("maps tokens to the scheme's palette and untagged text to the foreground", () => {
    const dark = createTokenStyles("dark", "#fafafa");
    expect(tokenStyleFor(dark, "keyword")).toEqual({ color: darkHighlightColors.keyword });
    expect(tokenStyleFor(dark, null)).toEqual({ color: "#fafafa" });
    const light = createTokenStyles("light", "#09090b");
    expect(tokenStyleFor(light, "string")).toEqual({ color: lightHighlightColors.string });
  });
});
