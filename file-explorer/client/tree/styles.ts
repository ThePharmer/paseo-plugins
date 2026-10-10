import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle, ViewStyle } from "react-native";

// Sizes follow the core Files pane: packages/app/src/components/tree-primitives.tsx (row
// density, indentation, icon slot) and pane-content-toolbar.tsx / icon-button-chrome.ts (toolbar
// height and icon buttons). Core tokens without a plugin equivalent map to the nearest one:
// surfaceSidebarHover -> surface1, foregroundExtraMuted -> foregroundMuted.

export const TREE_INDENT_PER_LEVEL = 12;
export const TREE_ICON_SIZE = 16;
const TREE_ROW_VERTICAL_PADDING = 6;
const TREE_ROW_LEADING_PADDING = 12;
const TRAILING_GLYPH_RAIL = 8;
const TOOLBAR_HEIGHT = 36;

export function toolbarIconSize(compact: boolean): number {
  return compact ? 18 : 14;
}

function toolbarButtonSize(compact: boolean): number {
  return compact ? 32 : 20;
}

export function treeRowPaddingLeft(depth: number): number {
  return TREE_ROW_LEADING_PADDING + depth * TREE_INDENT_PER_LEVEL;
}

export interface TreeStyles {
  container: ViewStyle;
  toolbar: ViewStyle;
  toolbarControls: ViewStyle;
  toolbarButton: ViewStyle;
  toolbarButtonActive: ViewStyle;
  sortTrigger: ViewStyle;
  sortTriggerActive: ViewStyle;
  sortTriggerText: TextStyle;
  list: ViewStyle;
  listContent: ViewStyle;
  row: ViewStyle;
  rowActive: ViewStyle;
  rowPressable: ViewStyle;
  entryIcon: ViewStyle;
  chevronExpanded: ViewStyle;
  spinner: ViewStyle;
  entryName: TextStyle;
  entryNameHovered: TextStyle;
  moreButton: ViewStyle;
  moreButtonActive: ViewStyle;
  moreButtonHidden: ViewStyle;
  errorRowText: TextStyle;
  centerState: ViewStyle;
  mutedText: TextStyle;
  errorText: TextStyle;
  pillButton: ViewStyle;
  pillButtonText: TextStyle;
}

export function createTreeStyles(theme: PluginTheme, compact: boolean): TreeStyles {
  const { colors } = theme;
  const buttonSize = toolbarButtonSize(compact);
  const iconSize = toolbarIconSize(compact);
  return {
    container: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    toolbar: {
      height: TOOLBAR_HEIGHT,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      // A bare glyph's hitbox overhangs its ink, so pad by less than the rail.
      paddingRight: TRAILING_GLYPH_RAIL - (buttonSize - iconSize) / 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface0,
    },
    toolbarControls: { flexDirection: "row", alignItems: "center", gap: 1 },
    toolbarButton: {
      width: buttonSize,
      height: buttonSize,
      borderRadius: 4,
      alignItems: "center",
      justifyContent: "center",
    },
    toolbarButtonActive: { backgroundColor: colors.surface2 },
    sortTrigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      marginLeft: 8,
      paddingHorizontal: 4,
      height: 24,
      borderRadius: 4,
    },
    sortTriggerActive: { backgroundColor: colors.surface1 },
    sortTriggerText: { fontSize: 12, color: colors.foregroundMuted },
    list: { flex: 1, minHeight: 0 },
    listContent: { flexGrow: 1, paddingTop: 8, paddingBottom: 16 },
    row: { flexDirection: "row", alignItems: "center", paddingRight: TRAILING_GLYPH_RAIL },
    rowActive: { backgroundColor: colors.surface1 },
    rowPressable: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: TREE_ROW_VERTICAL_PADDING,
    },
    entryIcon: {
      width: TREE_ICON_SIZE,
      height: TREE_ICON_SIZE,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    chevronExpanded: { transform: [{ rotate: "90deg" }] },
    // ActivityIndicator has no numeric size on iOS; scale "small" (20) to the 14px core spinner.
    spinner: { transform: [{ scale: 0.7 }] },
    entryName: {
      flex: 1,
      fontSize: 14,
      color: colors.foreground,
      opacity: 0.76,
      userSelect: "none",
    },
    entryNameHovered: { opacity: 1 },
    moreButton: {
      width: 20,
      height: 20,
      borderRadius: 4,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    moreButtonActive: { backgroundColor: colors.surface2 },
    moreButtonHidden: { opacity: 0 },
    errorRowText: {
      flex: 1,
      fontSize: 12,
      color: colors.statusDanger,
      paddingVertical: TREE_ROW_VERTICAL_PADDING,
    },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 16,
    },
    mutedText: { fontSize: 14, color: colors.foregroundMuted, textAlign: "center" },
    errorText: { fontSize: 14, color: colors.statusDanger, textAlign: "center" },
    pillButton: {
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    pillButtonText: { fontSize: 14, fontWeight: "600", color: colors.foregroundMuted },
  };
}
