import type {
  PluginClientContext,
  PluginClientContribution,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { openFilesRpc } from "../shared/open-files";
import { createFallbackPanelContribution, createFilePanelContribution } from "./panels/file-panel";
import { createFoldersPanel, FOLDERS_PANEL_ID } from "./panels/folders-panel";
import { BROWSE_SCREEN_ID, createBrowseScreen } from "./screens/browse-screen";
import {
  FILE_SCREEN_ID,
  FileScreen,
  fileScreenParams,
  fileScreenTitle,
} from "./screens/file-screen";
import { FOLDERS_SETTINGS_ID, FoldersSettings } from "./settings/folders-settings";
import { Platform } from "react-native";
import { createFallbackSelectionStore } from "./tabs/fallback-selection";
import {
  createLocalOpenFiles,
  defaultTextStoreSources,
  resolveTextStore,
} from "./tabs/local-open-files";
import { createFileTabs } from "./tabs/registry";

function BrowseItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const screenId = currentScreen?.screenId;
  const openBrowse = useCallback(() => openScreen({ screenId: BROWSE_SCREEN_ID }), [openScreen]);
  return (
    <SidebarRow
      icon="FolderTree"
      active={screenId === BROWSE_SCREEN_ID || screenId === FILE_SCREEN_ID}
      onPress={openBrowse}
    />
  );
}

function contribute(client: PluginClientContext) {
  const fallbackSelection = createFallbackSelectionStore();
  // Registers the panels for this device's remembered files before contribute() returns, which
  // is the only way tabs restored from the last session resolve. See client/tabs/registry.ts.
  const tabs = createFileTabs({
    host: {
      addWorkspacePanel: (contribution) => client.addWorkspacePanel(contribution),
      openPanel: (panelId, workspaceId) => client.openPanel(panelId, { workspaceId }),
      storage: {
        read: () => client.rpc(openFilesRpc.read, {}),
        write: (input) => client.rpc(openFilesRpc.write, input),
      },
      local: createLocalOpenFiles(resolveTextStore(Platform.OS, defaultTextStoreSources)),
      now: () => new Date().toISOString(),
    },
    panels: {
      filePanel: (file, panelId) =>
        createFilePanelContribution(file, panelId, (mountedFile) => tabs.trackMounted(mountedFile)),
      fallbackPanel: () => createFallbackPanelContribution(fallbackSelection),
    },
    fallback: fallbackSelection,
  });
  function openSettings() {
    client.openSettings(FOLDERS_SETTINGS_ID);
  }

  client.addSettingsScreen({
    id: FOLDERS_SETTINGS_ID,
    title: "Allowed folders",
    icon: "FolderCog",
    Component: FoldersSettings,
  });
  client.addScreen({
    id: BROWSE_SCREEN_ID,
    title: "Allowed folders",
    Component: createBrowseScreen({
      openFile: (file) =>
        client.openScreen({ screenId: FILE_SCREEN_ID, params: fileScreenParams(file) }),
      openSettings,
    }),
  });
  client.addScreen({ id: FILE_SCREEN_ID, title: fileScreenTitle, Component: FileScreen });
  client.addSidebarHeaderItem({
    id: BROWSE_SCREEN_ID,
    title: "Allowed folders",
    Component: BrowseItem,
  });
  client.addWorkspacePanel({
    id: FOLDERS_PANEL_ID,
    title: "Folders",
    icon: "FolderTree",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: createFoldersPanel({ tabs, openSettings }),
  });
  client.addCommandCenterItem({
    id: "browse-folders",
    title: "Browse allowed folders",
    icon: "FolderTree",
    keywords: ["files", "explorer"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: BROWSE_SCREEN_ID });
    },
  });
  client.addCommandCenterItem({
    id: "open-folders-explorer",
    title: "Open allowed folders in Explorer",
    icon: "FolderTree",
    keywords: ["files", "sidebar"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(FOLDERS_PANEL_ID, { location: "explorer" });
    },
  });

  // Adds the host's list once it lands: files this device has no local copy of, and the + menu
  // entries for them. Tabs mounted before then stay "unavailable" until reopened from the tree.
  void tabs.restore().catch(() => undefined);

  return () => {
    tabs.dispose();
  };
}

// Checks the type client/dist/index.d.ts declares for the built file.
export default contribute satisfies PluginClientContribution;
