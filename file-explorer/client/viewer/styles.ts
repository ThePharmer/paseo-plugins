import { Platform, StyleSheet } from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";

// Values mirror core's theme tokens (packages/app/src/styles/theme.ts): spacing 1.5/2/3/4,
// fontSize sm 12 / base 14 / code 12, borderRadius md 6. PluginTheme carries colors only.
const FONT_SIZE = { sm: 12, base: 14, code: 12 } as const;

// Core's DEFAULT_MONO_FONT_STACK. "ui-monospace" is SF Mono on iOS (Fabric's RCTFontUtils).
export const MONO_FONT_FAMILY = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});

// Fixed so FlatList can skip measuring rows. Core sizes rows at code size x 1.45 (17.4 px) but
// reports 20 px to getItemLayout; one value for both keeps scroll math exact for unwrapped lines.
export const SOURCE_LINE_HEIGHT = 18;
const GUTTER_WIDTH = 56;
export const IMAGE_INSET = 16;

// Core's icon button chrome: 20 px frame and 14 px glyph, 32 px and 18 px on compact.
export function iconGlyphSize(compact: boolean): number {
  return compact ? 18 : 14;
}

export type ViewerTheme = PluginHostProps["theme"];

export function createViewerStyles(theme: ViewerTheme, compact: boolean) {
  const { colors } = theme;
  const iconFrame = compact ? 32 : 20;
  return StyleSheet.create({
    container: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: compact ? 52 : 44,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface0,
      flexShrink: 0,
    },
    titleColumn: { flex: 1, minWidth: 0, gap: 2 },
    fileName: { color: colors.foreground, fontSize: FONT_SIZE.base, fontWeight: "500" },
    filePath: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
    metadata: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, flexShrink: 0 },
    actions: { flexDirection: "row", alignItems: "center", gap: compact ? 4 : 2, flexShrink: 0 },
    iconButton: {
      width: iconFrame,
      height: iconFrame,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonHighlighted: { backgroundColor: colors.surface2 },
    disabled: { opacity: 0.5 },
    progress: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, minWidth: 32 },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 16,
    },
    stateText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.base, textAlign: "center" },
    errorText: { color: colors.statusDanger, fontSize: FONT_SIZE.base, textAlign: "center" },
    textButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 32,
      paddingHorizontal: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    textButtonLabel: { color: colors.foreground, fontSize: FONT_SIZE.base },
    sourceList: { flex: 1, minHeight: 0 },
    sourceLine: { flexDirection: "row", minHeight: SOURCE_LINE_HEIGHT },
    gutter: {
      width: GUTTER_WIDTH,
      paddingRight: 12,
      textAlign: "right",
      color: colors.foregroundMuted,
      fontFamily: MONO_FONT_FAMILY,
      fontSize: FONT_SIZE.code,
      lineHeight: SOURCE_LINE_HEIGHT,
    },
    sourceText: {
      flex: 1,
      paddingRight: 12,
      color: colors.foreground,
      fontFamily: MONO_FONT_FAMILY,
      fontSize: FONT_SIZE.code,
      lineHeight: SOURCE_LINE_HEIGHT,
    },
    imageFrame: {
      flex: 1,
      minHeight: 0,
      alignItems: "center",
      justifyContent: "center",
      padding: IMAGE_INSET,
    },
  });
}

export type ViewerStyles = ReturnType<typeof createViewerStyles>;
