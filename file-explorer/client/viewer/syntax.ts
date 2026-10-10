// Token coloring ported from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/styles/syntax-token-styles.ts (Apache-2.0, Copyright (c) 2025-present
// Mohamed Boudra).
// Modified: PluginTheme carries no syntax colors, so the scheme is inferred from the surface and
// the colors come from @getpaseo/highlight's default palettes, which core's built-in themes use.

import {
  darkHighlightColors,
  lightHighlightColors,
  type HighlightStyle,
} from "@getpaseo/highlight";

export type ColorScheme = "light" | "dark";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface TokenColorStyle {
  color: string;
}

export type TokenStyles = Readonly<Record<HighlightStyle, TokenColorStyle>> & {
  readonly base: TokenColorStyle;
};

// Relative luminance where black and white text have equal WCAG contrast. Darker surfaces read
// better with light text, so they get the dark palette.
const DARK_SURFACE_LUMINANCE = 0.179;

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(). Alpha is ignored. */
export function parseColor(value: string): Rgb | null {
  const color = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(color);
  if (hex) {
    const digits = hex[1];
    if (digits.length <= 4) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      };
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(color);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

/** WCAG 2 relative luminance, 0 for black to 1 for white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

function linearChannel(channel: number): number {
  const value = Math.min(Math.max(channel, 0), 255) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * The host theme's color scheme, inferred from its main surface. A theme color this cannot parse
 * falls back to the foreground: light text means a dark theme.
 */
export function colorSchemeForTheme(colors: { surface0: string; foreground: string }): ColorScheme {
  const surface = parseColor(colors.surface0);
  if (surface) {
    return relativeLuminance(surface) <= DARK_SURFACE_LUMINANCE ? "dark" : "light";
  }
  const foreground = parseColor(colors.foreground);
  if (foreground) {
    return relativeLuminance(foreground) > DARK_SURFACE_LUMINANCE ? "dark" : "light";
  }
  return "dark";
}

/** One color style per highlight token, plus `base` for untagged text, as core maps them. */
export function createTokenStyles(scheme: ColorScheme, foreground: string): TokenStyles {
  const palette = scheme === "dark" ? darkHighlightColors : lightHighlightColors;
  return {
    base: { color: foreground },
    keyword: { color: palette.keyword },
    comment: { color: palette.comment },
    string: { color: palette.string },
    number: { color: palette.number },
    literal: { color: palette.literal },
    function: { color: palette.function },
    definition: { color: palette.definition },
    class: { color: palette.class },
    type: { color: palette.type },
    tag: { color: palette.tag },
    attribute: { color: palette.attribute },
    property: { color: palette.property },
    variable: { color: palette.variable },
    operator: { color: palette.operator },
    punctuation: { color: palette.punctuation },
    regexp: { color: palette.regexp },
    escape: { color: palette.escape },
    meta: { color: palette.meta },
    heading: { color: palette.heading },
    link: { color: palette.link },
  };
}

export function tokenStyleFor(styles: TokenStyles, style: HighlightStyle | null): TokenColorStyle {
  return style === null ? styles.base : styles[style];
}
