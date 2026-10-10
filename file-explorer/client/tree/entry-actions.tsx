import type { PluginHostProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { FileExplorerEntry } from "../../shared/rpc";
import { canSaveFiles } from "../download/save-file";
import { FileIcon } from "../file-icon";
import { buildAbsoluteExplorerPath } from "./paths";
import { useSaveEntry } from "./save-entry";

// The row menu: the read-only subset of core's file actions menu
// (packages/app/src/components/file-actions-menu.tsx). Core anchors a context menu to the row;
// plugins get the host Modal, a bottom sheet on compact layouts and a dialog otherwise.

interface EntryActionsModalProps {
  root: string;
  /** The entry the menu is for. Kept after closing so the sheet does not empty while it animates. */
  entry: FileExplorerEntry | null;
  open: boolean;
  onClose(): void;
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
}

interface EntryAction {
  id: string;
  label: string;
  icon: string;
  run(): void;
}

export function EntryActionsModal({
  root,
  entry,
  open,
  onClose,
  theme,
  layout,
}: EntryActionsModalProps) {
  const toast = useToast();
  const saveEntry = useSaveEntry(layout.platform);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const actions = useMemo<EntryAction[]>(() => {
    if (!entry) return [];
    const target = entry;
    async function copy(text: string, what: string) {
      try {
        await copyText(text);
        toast.show(`Copied ${what}`, { variant: "success" });
      } catch {
        toast.error("Could not copy. Select the text and use Copy.");
      }
    }
    const list: EntryAction[] = [
      {
        id: "copy-path",
        label: "Copy path",
        icon: "Copy",
        run: () => void copy(buildAbsoluteExplorerPath({ root, entryPath: target.path }), "path"),
      },
      {
        id: "copy-relative-path",
        label: "Copy relative path",
        icon: "Copy",
        run: () => void copy(target.path, "relative path"),
      },
    ];
    if (target.kind === "file" && canSaveFiles(layout.platform)) {
      const isWeb = layout.platform === "web";
      list.push({
        id: "save",
        label: isWeb ? "Download" : "Share",
        icon: isWeb ? "Download" : "Share",
        run: () => void saveEntry({ root, path: target.path, name: target.name }),
      });
    }
    return list;
  }, [layout.platform, root, saveEntry, entry, toast]);

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  return (
    <Modal
      title={entry?.name ?? ""}
      icon={<EntryIcon entry={entry} color={theme.colors.foregroundMuted} />}
      open={open && entry !== null}
      onOpenChange={handleOpenChange}
    >
      <Modal.Content contentContainerStyle={styles.content}>
        {actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            styles={styles}
            iconColor={theme.colors.foregroundMuted}
            onDone={onClose}
          />
        ))}
      </Modal.Content>
    </Modal>
  );
}

function EntryIcon({ entry, color }: { entry: FileExplorerEntry | null; color: string }) {
  if (entry?.kind === "file") return <FileIcon fileName={entry.name} size={18} />;
  return <Icon name="Folder" size={18} color={color} />;
}

interface ActionRowProps {
  action: EntryAction;
  styles: ActionStyles;
  iconColor: string;
  onDone(): void;
}

function ActionRow({ action, styles, iconColor, onDone }: ActionRowProps) {
  const [hovered, setHovered] = useState(false);
  function press() {
    onDone();
    action.run();
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={press}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={hovered ? [styles.row, styles.rowHovered] : styles.row}
    >
      <View style={styles.rowIcon}>
        <Icon name={action.icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.rowLabel}>{action.label}</Text>
    </Pressable>
  );
}

type ActionStyles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginHostProps["theme"]) {
  return {
    content: { padding: 8, gap: 0 },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 6,
    },
    rowHovered: { backgroundColor: theme.colors.surface2 },
    rowIcon: {
      width: 16,
      height: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    rowLabel: { flex: 1, fontSize: 14, color: theme.colors.foreground },
  };
}
