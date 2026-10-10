// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/components/file-explorer-pane.tsx (TreeRowItem) and
// packages/app/src/components/tree-primitives.tsx (Apache-2.0, Copyright (c) 2025-present
// Mohamed Boudra).
// Modified: plain styles from the plugin theme; the context menu becomes a long press (all
// platforms) plus a hover "more" button on web; no drag source or editing rows.

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { FileExplorerEntry } from "../../shared/rpc";
import { FileIcon } from "../file-icon";
import { TREE_ICON_SIZE, type TreeStyles, treeRowPaddingLeft } from "./styles";

interface TreeRowProps {
  entry: FileExplorerEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  selected: boolean;
  menuOpen: boolean;
  /** Hover exists only on web; native rows open their menu with a long press. */
  hoverable: boolean;
  styles: TreeStyles;
  theme: PluginTheme;
  onPress(entry: FileExplorerEntry): void;
  onOpenMenu(entry: FileExplorerEntry): void;
}

export const TreeRow = memo(function TreeRow({
  entry,
  depth,
  expanded,
  loading,
  selected,
  menuOpen,
  hoverable,
  styles,
  theme,
  onPress,
  onOpenMenu,
}: TreeRowProps) {
  // The row and its "more" button are sibling pressables, so hover is the union of both: moving
  // from the row onto the button must not hide the button.
  const [rowHovered, setRowHovered] = useState(false);
  const [moreHovered, setMoreHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const hovered = rowHovered || moreHovered;
  const highlighted = hovered || pressed || selected || menuOpen;
  const showMore = hovered || menuOpen;
  const isDirectory = entry.kind === "directory";

  return (
    <View style={highlighted ? [styles.row, styles.rowActive] : styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        accessibilityState={{ selected, expanded: isDirectory ? expanded : undefined }}
        onPress={() => onPress(entry)}
        onLongPress={() => onOpenMenu(entry)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={() => setRowHovered(true)}
        onHoverOut={() => setRowHovered(false)}
        style={[styles.rowPressable, { paddingLeft: treeRowPaddingLeft(depth) }]}
      >
        <View style={styles.entryIcon}>
          <EntryGlyph
            isDirectory={isDirectory}
            name={entry.name}
            expanded={expanded}
            loading={loading}
            styles={styles}
            color={theme.colors.foregroundMuted}
          />
        </View>
        <Text
          numberOfLines={1}
          style={hovered ? [styles.entryName, styles.entryNameHovered] : styles.entryName}
        >
          {entry.name}
        </Text>
      </Pressable>
      {hoverable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More actions"
          hitSlop={4}
          onPress={() => onOpenMenu(entry)}
          onHoverIn={() => setMoreHovered(true)}
          onHoverOut={() => setMoreHovered(false)}
          // Hidden with opacity, not unmounted, so revealing it never shifts the row.
          style={[
            styles.moreButton,
            moreHovered || menuOpen ? styles.moreButtonActive : null,
            showMore ? null : styles.moreButtonHidden,
          ]}
        >
          <Icon name="Ellipsis" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

interface EntryGlyphProps {
  isDirectory: boolean;
  name: string;
  expanded: boolean;
  loading: boolean;
  styles: TreeStyles;
  color: string;
}

/** Folders show core's disclosure chevron in the icon slot; core draws no folder icon. */
function EntryGlyph({ isDirectory, name, expanded, loading, styles, color }: EntryGlyphProps) {
  if (!isDirectory) return <FileIcon fileName={name} size={TREE_ICON_SIZE} />;
  if (loading) return <ActivityIndicator size="small" color={color} style={styles.spinner} />;
  return (
    <View style={expanded ? styles.chevronExpanded : null}>
      <Icon name="ChevronRight" size={TREE_ICON_SIZE} color={color} />
    </View>
  );
}

interface TreeErrorRowProps {
  depth: number;
  error: string;
  styles: TreeStyles;
}

export function TreeErrorRow({ depth, error, styles }: TreeErrorRowProps) {
  return (
    <View style={styles.row}>
      <Text
        numberOfLines={2}
        style={[styles.errorRowText, { paddingLeft: treeRowPaddingLeft(depth) }]}
      >
        {error}
      </Text>
    </View>
  );
}
