import { Text, View } from "react-native";
import { IconButton } from "./controls";
import { formatFileSize } from "./path";
import type { ViewerStyles, ViewerTheme } from "./styles";
import type { SaveAction } from "./use-save-action";

export interface ViewerHeaderProps {
  fileName: string;
  absolutePath: string;
  size: number | null;
  lineCount: number | null;
  refreshing: boolean;
  onRefresh(): void;
  onCopyPath(): void;
  save: SaveAction | null;
  compact: boolean;
  theme: ViewerTheme;
  styles: ViewerStyles;
}

/** Pane chrome above the file: name and path, size, then the file's actions. */
export function ViewerHeader({
  fileName,
  absolutePath,
  size,
  lineCount,
  refreshing,
  onRefresh,
  onCopyPath,
  save,
  compact,
  theme,
  styles,
}: ViewerHeaderProps) {
  const metadata = formatMetadata({ size, lineCount, compact });
  const controlProps = { compact, theme, styles };
  return (
    <View style={styles.header}>
      <View style={styles.titleColumn}>
        <Text style={styles.fileName} numberOfLines={1}>
          {fileName}
        </Text>
        <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="head" selectable>
          {absolutePath}
        </Text>
      </View>
      {metadata ? <Text style={styles.metadata}>{metadata}</Text> : null}
      <View style={styles.actions}>
        {save?.progress.status === "transferring" ? (
          <Text style={styles.progress}>{`${save.progress.percent}%`}</Text>
        ) : null}
        <IconButton
          icon="RefreshCw"
          label="Refresh"
          onPress={onRefresh}
          busy={refreshing}
          {...controlProps}
        />
        <IconButton icon="Copy" label="Copy path" onPress={onCopyPath} {...controlProps} />
        {save ? (
          <IconButton
            icon={save.icon}
            label={save.label}
            onPress={save.start}
            busy={save.progress.status === "transferring"}
            {...controlProps}
          />
        ) : null}
      </View>
    </View>
  );
}

function formatMetadata(input: {
  size: number | null;
  lineCount: number | null;
  compact: boolean;
}): string | null {
  if (input.size === null) return null;
  const size = formatFileSize(input.size);
  // Compact headers keep the row for the path and actions.
  if (input.lineCount === null || input.compact) return size;
  return `${size} · ${input.lineCount} lines`;
}
