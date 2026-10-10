// Ported from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/utils/color.ts (the OKLab helpers, parseHexColor, desaturateHexColor) and
// packages/app/src/components/file-icon-svg.ts (ICON_CHROMA, HEX_COLOR_PATTERN, toneSvg)
// (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: TypeScript annotations removed so plain Node can run this file; unused helpers
// (hexColorWithAlpha) and the runtime cache dropped. The maths and constants are unchanged.
//
// Colour maths in OKLab. Holding L fixed and scaling the a/b vector moves a colour toward grey
// at the same apparent lightness, so hue still says what the file is while the icon sits quieter
// in a row. Reducing chroma always stays inside sRGB, so no gamut mapping is needed.

/** Fraction of the vendor chroma to keep. Matches core Paseo; move it in lockstep with core. */
export const ICON_CHROMA = 0.65;

/** Anything hex-shaped. `desaturateHexColor` returns lengths it does not own untouched. */
const HEX_COLOR_PATTERN = /#[0-9a-fA-F]+/g;

function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function linearRgbToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToLinearRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Parses `#rgb` and `#rrggbb` into 0-1 sRGB channels. Anything else is not a colour we own. */
function parseHexColor(hex) {
  const body = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]+$/.test(body)) return null;

  let expanded;
  if (body.length === 3) {
    expanded = `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  } else if (body.length === 6) {
    expanded = body;
  } else {
    return null;
  }

  return [
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
  ];
}

function toHexChannel(channel) {
  const clamped = Math.min(255, Math.max(0, Math.round(channel * 255)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * Scales a colour's chroma toward neutral while holding its perceived lightness. `amount` is the
 * fraction of the original chroma to keep. Input that is not a hex colour comes back untouched.
 */
export function desaturateHexColor(hex, amount) {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;

  const [r, g, b] = rgb;
  const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  const [linearR, linearG, linearB] = oklabToLinearRgb({
    L: lab.L,
    a: lab.a * amount,
    b: lab.b * amount,
  });

  return `#${toHexChannel(linearToSrgb(linearR))}${toHexChannel(linearToSrgb(linearG))}${toHexChannel(linearToSrgb(linearB))}`;
}

/** Tones every hex colour in a vendor SVG, as core's getFileIconSvg does before rendering. */
export function toneSvg(svg) {
  return svg.replace(HEX_COLOR_PATTERN, (hex) => desaturateHexColor(hex, ICON_CHROMA));
}
