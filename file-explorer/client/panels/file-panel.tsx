import type {
  PluginWorkspacePanelContribution,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { FALLBACK_PANEL_ID } from "../tabs/registry";
import type { FallbackSelectionStore } from "../tabs/fallback-selection";
import type { FileRef } from "../tabs/panel-id";
import { fileTabIcon } from "../tabs/tab-icon";
import { explorerBasename } from "../tree/paths";
import { FileViewer } from "../viewer/file-viewer";

/** The workspace panel for one file: its tab is titled and iconed after the file. */
export function createFilePanelContribution(
  file: FileRef,
  panelId: string,
  trackMounted: (file: FileRef) => () => void,
): PluginWorkspacePanelContribution {
  const name = explorerBasename(file.path);
  function FilePanel({ theme, layout }: PluginWorkspacePanelProps) {
    useEffect(() => trackMounted(file), []);
    return <FileViewer root={file.root} path={file.path} theme={theme} layout={layout} />;
  }
  return {
    id: panelId,
    title: name,
    icon: fileTabIcon(name),
    context: "workspace",
    locations: ["workspace"],
    Component: FilePanel,
  };
}

/** The shared panel used when per-file panels cannot be registered at runtime. */
export function createFallbackPanelContribution(
  selection: FallbackSelectionStore,
): PluginWorkspacePanelContribution {
  function FallbackFilePanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
    const file = useSyncExternalStore(
      selection.subscribe,
      () => selection.get(workspaceId),
      () => selection.get(workspaceId),
    );
    const styles = useMemo(
      () => ({
        empty: {
          flex: 1,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          padding: 16,
          backgroundColor: theme.colors.surface0,
        },
        text: { fontSize: 14, color: theme.colors.foregroundMuted, textAlign: "center" as const },
      }),
      [theme],
    );
    if (!file) {
      return (
        <View style={styles.empty}>
          <Text style={styles.text}>Open a file from the Folders panel</Text>
        </View>
      );
    }
    return (
      <FileViewer
        key={`${file.root}\n${file.path}`}
        root={file.root}
        path={file.path}
        theme={theme}
        layout={layout}
      />
    );
  }
  return {
    id: FALLBACK_PANEL_ID,
    title: "File",
    icon: "File",
    context: "workspace",
    locations: ["workspace"],
    Component: FallbackFilePanel,
  };
}
