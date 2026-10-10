import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { AllowedFolder } from "../../shared/rpc";

// The folder switcher at the top of the tree. A host Modal rather than an anchored dropdown:
// it is a bottom sheet on phones and works the same in the narrow Explorer dock.

export const FOLDER_STATUS_LABELS: Readonly<Record<AllowedFolder["status"], string | null>> = {
  ready: null,
  missing: "Folder not found",
  "not-directory": "Not a folder",
};

interface FolderPickerProps {
  folders: readonly AllowedFolder[];
  active: AllowedFolder;
  theme: PluginHostProps["theme"];
  onSelect(root: string): void;
  onManage(): void;
}

export function FolderPicker({ folders, active, theme, onSelect, onManage }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const muted = theme.colors.foregroundMuted;

  function select(root: string) {
    setOpen(false);
    onSelect(root);
  }

  function manage() {
    setOpen(false);
    onManage();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Folder: ${active.label}. Switch folder`}
        onPress={() => setOpen(true)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger}
      >
        <Icon name="FolderOpen" size={16} color={muted} />
        <Text numberOfLines={1} style={styles.triggerLabel}>
          {active.label}
        </Text>
        <Icon name="ChevronsUpDown" size={14} color={muted} />
      </Pressable>
      <Modal
        title="Allowed folders"
        icon={<Icon name="FolderTree" size={18} color={muted} />}
        open={open}
        onOpenChange={setOpen}
      >
        <Modal.Content contentContainerStyle={styles.content}>
          {folders.map((folder) => (
            <FolderOption
              key={folder.root}
              folder={folder}
              selected={folder.root === active.root}
              styles={styles}
              theme={theme}
              onPress={() => select(folder.root)}
            />
          ))}
          <OptionRow styles={styles} label="Manage allowed folders" onPress={manage}>
            <Icon name="Settings" size={16} color={muted} />
            <View style={styles.optionText}>
              <Text numberOfLines={1} style={styles.optionLabel}>
                Manage allowed folders
              </Text>
            </View>
          </OptionRow>
        </Modal.Content>
      </Modal>
    </>
  );
}

interface FolderOptionProps {
  folder: AllowedFolder;
  selected: boolean;
  styles: PickerStyles;
  theme: PluginHostProps["theme"];
  onPress(): void;
}

function FolderOption({ folder, selected, styles, theme, onPress }: FolderOptionProps) {
  const status = FOLDER_STATUS_LABELS[folder.status];
  return (
    <OptionRow styles={styles} label={folder.label} onPress={onPress} selected={selected}>
      <Icon name="Folder" size={16} color={theme.colors.foregroundMuted} />
      <View style={styles.optionText}>
        <Text numberOfLines={1} style={styles.optionLabel}>
          {folder.label}
        </Text>
        <Text numberOfLines={1} style={styles.optionDetail}>
          {folder.root}
        </Text>
        {status ? <Text style={styles.optionStatus}>{status}</Text> : null}
      </View>
      {selected ? <Icon name="Check" size={16} color={theme.colors.foreground} /> : null}
    </OptionRow>
  );
}

interface OptionRowProps {
  label: string;
  selected?: boolean;
  styles: PickerStyles;
  onPress(): void;
  children: ReactNode;
}

function OptionRow({ label, selected = false, styles, onPress, children }: OptionRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={hovered ? [styles.option, styles.optionHovered] : styles.option}
    >
      {children}
    </Pressable>
  );
}

type PickerStyles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginHostProps["theme"]) {
  const { colors } = theme;
  return {
    trigger: {
      height: 36,
      flexShrink: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface0,
    },
    triggerHovered: { backgroundColor: colors.surface1 },
    triggerLabel: { flex: 1, fontSize: 14, color: colors.foreground },
    content: { padding: 8, gap: 0 },
    option: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 6,
    },
    optionHovered: { backgroundColor: colors.surface2 },
    optionText: { flex: 1, minWidth: 0, gap: 2 },
    optionLabel: { fontSize: 14, color: colors.foreground },
    optionDetail: { fontSize: 12, color: colors.foregroundMuted },
    optionStatus: { fontSize: 12, color: colors.statusWarning },
  };
}
