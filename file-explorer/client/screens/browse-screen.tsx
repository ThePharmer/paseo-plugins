import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import type { FileRef } from "../tabs/panel-id";
import { FolderTree } from "../tree/folder-tree";

export const BROWSE_SCREEN_ID = "browse";

interface BrowseScreenDependencies {
  openFile(file: FileRef): void;
  openSettings(): void;
}

/** The tree as a full screen, independent of any workspace. Files open the file screen. */
export function createBrowseScreen({
  openFile,
  openSettings,
}: BrowseScreenDependencies): ComponentType<PluginScreenProps> {
  return function BrowseScreen({ theme, layout }: PluginScreenProps) {
    return (
      <FolderTree
        placement={BROWSE_SCREEN_ID}
        theme={theme}
        layout={layout}
        onOpenFile={openFile}
        onOpenSettings={openSettings}
      />
    );
  };
}
