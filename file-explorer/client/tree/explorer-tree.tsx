// Copied from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/components/file-explorer-pane.tsx (FileExplorerPane and
// FileExplorerPaneContent) (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra).
// Modified: read-only (no create, rename, duplicate, delete or drag); listings come from plugin
// RPC through React Query instead of the session store; the root is an allowed folder.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  Text,
  View,
} from "react-native";
import type { FileExplorerEntry } from "../../shared/rpc";
import type { FileRef } from "../tabs/panel-id";
import { EntryActionsModal } from "./entry-actions";
import { explorerQueryKeys, useDirectories } from "./queries";
import { buildTreeListRows, type TreeListRow, treeListRowKey } from "./rows";
import { createTreeStyles, type TreeStyles, toolbarIconSize } from "./styles";
import { TreeErrorRow, TreeRow } from "./tree-row";
import {
  flattenExplorerTree,
  reachableExpandedPaths,
  ROOT_DIRECTORY_PATH,
  SORT_LABELS,
} from "./tree";
import { treeViewStore, useTreeView } from "./use-tree-view";
import { expandedPathsFor, placementState } from "./view-store";

interface ExplorerTreeProps {
  /** Which surface this tree belongs to; each keeps its own expansion and selection. */
  placement: string;
  root: string;
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
  onOpenFile(file: FileRef): void;
}

interface MenuState {
  entry: FileExplorerEntry | null;
  open: boolean;
}

const CLOSED_MENU: MenuState = { entry: null, open: false };

export function ExplorerTree({ placement, root, theme, layout, onOpenFile }: ExplorerTreeProps) {
  const styles = useMemo(() => createTreeStyles(theme, layout.compact), [theme, layout.compact]);
  const preferences = useTreeView((state) => state.preferences);
  const view = useTreeView((state) => placementState(state, placement));
  const expandedList = expandedPathsFor(view, root);
  const expandedPaths = useMemo(() => new Set(expandedList), [expandedList]);
  const { showHiddenFiles, sortOption } = preferences;
  const paths = useMemo(
    () => reachableExpandedPaths(expandedPaths, showHiddenFiles),
    [expandedPaths, showHiddenFiles],
  );
  const { directories, states } = useDirectories(root, paths);
  const treeRows = useMemo(
    () => flattenExplorerTree({ directories, expandedPaths, sortOption, showHiddenFiles }),
    [directories, expandedPaths, showHiddenFiles, sortOption],
  );
  const listRows = useMemo(
    () => buildTreeListRows({ rows: treeRows, expandedPaths, directoryStates: states }),
    [expandedPaths, states, treeRows],
  );
  const selectedPath = view.selectedByRoot[root] ?? null;
  const [menu, setMenu] = useState<MenuState>(CLOSED_MENU);
  const queryClient = useQueryClient();
  // Refetches every listing on screen; inactive ones refetch when shown again.
  const refreshMutation = useMutation({
    mutationFn: () =>
      queryClient.invalidateQueries({ queryKey: explorerQueryKeys.directories(root) }),
  });

  const pressEntry = useCallback(
    (entry: FileExplorerEntry) => {
      treeViewStore.dispatch({ type: "select-entry", placement, root, path: entry.path });
      if (entry.kind === "directory") {
        treeViewStore.dispatch({ type: "toggle-directory", placement, root, path: entry.path });
        return;
      }
      onOpenFile({ root, path: entry.path });
    },
    [onOpenFile, placement, root],
  );
  const openMenu = useCallback((entry: FileExplorerEntry) => setMenu({ entry, open: true }), []);
  const closeMenu = useCallback(() => setMenu((current) => ({ ...current, open: false })), []);
  const { mutate: runRefresh, isPending: refreshing } = refreshMutation;
  const refresh = useCallback(() => runRefresh(), [runRefresh]);

  const hoverable = layout.platform === "web";
  const menuPath = menu.open ? (menu.entry?.path ?? null) : null;
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<TreeListRow>) => {
      if (item.type === "error") {
        return <TreeErrorRow depth={item.depth} error={item.error} styles={styles} />;
      }
      const { entry, depth } = item.row;
      return (
        <TreeRow
          entry={entry}
          depth={depth}
          expanded={item.expanded}
          loading={item.loading}
          selected={entry.path === selectedPath}
          menuOpen={entry.path === menuPath}
          hoverable={hoverable}
          styles={styles}
          theme={theme}
          onPress={pressEntry}
          onOpenMenu={openMenu}
        />
      );
    },
    [hoverable, menuPath, openMenu, pressEntry, selectedPath, styles, theme],
  );

  const rootState = states.get(ROOT_DIRECTORY_PATH);
  let body: ReactNode;
  if (rootState?.status === "error" && !directories.has(ROOT_DIRECTORY_PATH)) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{rootState.error}</Text>
        <PillButton label="Retry" styles={styles} onPress={refresh} />
      </View>
    );
  } else if (!directories.has(ROOT_DIRECTORY_PATH)) {
    body = (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        <Text style={styles.mutedText}>Loading files...</Text>
      </View>
    );
  } else if (listRows.length === 0) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{showHiddenFiles ? "No files" : "No visible files"}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={listRows}
        renderItem={renderRow}
        keyExtractor={treeListRowKey}
        initialNumToRender={24}
        maxToRenderPerBatch={40}
        windowSize={12}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TreeToolbar
        styles={styles}
        theme={theme}
        compact={layout.compact}
        sortLabel={SORT_LABELS[sortOption]}
        showHiddenFiles={showHiddenFiles}
        refreshing={refreshing}
        onRefresh={refresh}
      />
      {body}
      <EntryActionsModal
        root={root}
        entry={menu.entry}
        open={menu.open}
        onClose={closeMenu}
        theme={theme}
        layout={layout}
      />
    </View>
  );
}

interface TreeToolbarProps {
  styles: TreeStyles;
  theme: PluginHostProps["theme"];
  compact: boolean;
  sortLabel: string;
  showHiddenFiles: boolean;
  refreshing: boolean;
  onRefresh(): void;
}

function TreeToolbar({
  styles,
  theme,
  compact,
  sortLabel,
  showHiddenFiles,
  refreshing,
  onRefresh,
}: TreeToolbarProps) {
  const [sortHovered, setSortHovered] = useState(false);
  const iconSize = toolbarIconSize(compact);
  const iconColor = theme.colors.foregroundMuted;
  return (
    <View style={styles.toolbar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${sortLabel}`}
        onPress={() => treeViewStore.dispatch({ type: "cycle-sort" })}
        onHoverIn={() => setSortHovered(true)}
        onHoverOut={() => setSortHovered(false)}
        style={sortHovered ? [styles.sortTrigger, styles.sortTriggerActive] : styles.sortTrigger}
      >
        <Text style={styles.sortTriggerText}>{sortLabel}</Text>
        <Icon name="ChevronDown" size={12} color={iconColor} />
      </Pressable>
      <View style={styles.toolbarControls}>
        <ToolbarButton
          label={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
          selected={!showHiddenFiles}
          styles={styles}
          onPress={() => treeViewStore.dispatch({ type: "toggle-hidden-files" })}
        >
          <Icon name={showHiddenFiles ? "Eye" : "EyeOff"} size={iconSize} color={iconColor} />
        </ToolbarButton>
        <ToolbarButton
          label={refreshing ? "Refreshing files" : "Refresh files"}
          selected={false}
          disabled={refreshing}
          styles={styles}
          onPress={onRefresh}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={iconColor} style={styles.spinner} />
          ) : (
            <Icon name="RotateCw" size={iconSize} color={iconColor} />
          )}
        </ToolbarButton>
      </View>
    </View>
  );
}

interface ToolbarButtonProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  styles: TreeStyles;
  onPress(): void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  selected,
  disabled,
  styles,
  onPress,
  children,
}: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={active ? [styles.toolbarButton, styles.toolbarButtonActive] : styles.toolbarButton}
    >
      {children}
    </Pressable>
  );
}

interface PillButtonProps {
  label: string;
  styles: TreeStyles;
  onPress(): void;
}

export function PillButton({ label, styles, onPress }: PillButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.pillButton}
    >
      <Text style={styles.pillButtonText}>{label}</Text>
    </Pressable>
  );
}
