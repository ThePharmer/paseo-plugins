import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { type ComponentType, useCallback } from "react";
import type { FileRef } from "../tabs/panel-id";
import type { FileTabs, OpenFileTabOutcome } from "../tabs/registry";
import { FolderTree } from "../tree/folder-tree";

export const FOLDERS_PANEL_ID = "folders";

interface FoldersPanelDependencies {
  tabs: FileTabs;
  openSettings(): void;
}

/** The tree as a workspace panel. Files open as their own workspace tabs. */
export function createFoldersPanel({
  tabs,
  openSettings,
}: FoldersPanelDependencies): ComponentType<PluginWorkspacePanelProps> {
  return function FoldersPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
    const toast = useToast();

    const openFile = useCallback(
      (file: FileRef) => {
        let outcome: OpenFileTabOutcome;
        try {
          outcome = tabs.open({ ...file, workspaceId });
        } catch (error) {
          toast.error(`Unable to open file: ${errorMessage(error)}`);
          return;
        }
        if (outcome.tab === "file") {
          // The tab is already open; this only affects whether it comes back after a reload.
          outcome.persisted.catch((error: unknown) => {
            toast.show(`Open tabs were not saved: ${errorMessage(error)}`, { variant: "warning" });
          });
        }
      },
      [toast, workspaceId],
    );

    return (
      <FolderTree
        placement={`panel:${workspaceId}`}
        theme={theme}
        layout={layout}
        onOpenFile={openFile}
        onOpenSettings={openSettings}
      />
    );
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
