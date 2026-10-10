import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { FileRef } from "../tabs/panel-id";
import { ExplorerTree, PillButton } from "./explorer-tree";
import { FOLDER_STATUS_LABELS, FolderPicker } from "./folder-picker";
import { useAllowedFolders } from "./queries";
import { resolveActiveFolder } from "./rows";
import { createTreeStyles } from "./styles";
import { treeViewStore, useTreeView } from "./use-tree-view";
import { placementState } from "./view-store";

// The whole tree surface shared by the Folders panel and the browse screen: folder switcher,
// toolbar and tree. Only what pressing a file does differs between them.

export interface FolderTreeProps {
  /** "panel:<workspaceId>" or "browse"; keeps folder choice and expansion apart per surface. */
  placement: string;
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
  onOpenFile(file: FileRef): void;
  onOpenSettings(): void;
}

export function FolderTree({
  placement,
  theme,
  layout,
  onOpenFile,
  onOpenSettings,
}: FolderTreeProps) {
  const styles = useMemo(() => createTreeStyles(theme, layout.compact), [theme, layout.compact]);
  const folders = useAllowedFolders();
  const pickedRoot = useTreeView((state) => placementState(state, placement).root);

  if (folders.isPending) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        <Text style={styles.mutedText}>Loading folders...</Text>
      </View>
    );
  }
  if (folders.isError) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.errorText}>{folders.error.message}</Text>
        <PillButton label="Retry" styles={styles} onPress={() => void folders.refetch()} />
      </View>
    );
  }

  const active = resolveActiveFolder(folders.data, pickedRoot);
  if (!active) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.mutedText}>No allowed folders</Text>
        <PillButton label="Add a folder" styles={styles} onPress={onOpenSettings} />
      </View>
    );
  }

  const status = FOLDER_STATUS_LABELS[active.status];
  return (
    <View style={styles.container}>
      <FolderPicker
        folders={folders.data}
        active={active}
        theme={theme}
        onSelect={(root) => treeViewStore.dispatch({ type: "select-root", placement, root })}
        onManage={onOpenSettings}
      />
      {status ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{status}</Text>
          <Text selectable style={styles.mutedText}>
            {active.root}
          </Text>
          <PillButton label="Retry" styles={styles} onPress={() => void folders.refetch()} />
        </View>
      ) : (
        <ExplorerTree
          key={active.root}
          placement={placement}
          root={active.root}
          theme={theme}
          layout={layout}
          onOpenFile={onOpenFile}
        />
      )}
    </View>
  );
}
