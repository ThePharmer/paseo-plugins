import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { TextButton } from "./controls";
import { formatFileSize } from "./path";
import type { ViewerStyles, ViewerTheme } from "./styles";
import type { SaveAction } from "./use-save-action";

// Copy follows core's file pane strings (packages/app/src/i18n/resources/en.ts, panels.file).

interface StateProps {
  theme: ViewerTheme;
  styles: ViewerStyles;
}

export function LoadingState({ theme, styles }: StateProps) {
  return (
    <View style={styles.centerState}>
      <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      <Text style={styles.stateText}>Loading file...</Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  retrying,
  theme,
  styles,
}: StateProps & { message: string; onRetry(): void; retrying: boolean }) {
  return (
    <View style={styles.centerState}>
      <Text style={styles.errorText}>{message}</Text>
      <TextButton label="Retry" onPress={onRetry} busy={retrying} theme={theme} styles={styles} />
    </View>
  );
}

/** A file the viewer cannot show: too large, binary, or an image this device cannot draw. */
export function UnviewableState({
  title,
  size,
  note,
  save,
  theme,
  styles,
}: StateProps & {
  title: string;
  size: number | null;
  note: string | null;
  save: SaveAction | null;
}) {
  let action: ReactNode = null;
  if (save) {
    action = (
      <TextButton
        label={save.label}
        icon={save.icon}
        onPress={save.start}
        busy={save.progress.status === "transferring"}
        theme={theme}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.centerState}>
      <Text style={styles.stateText}>{title}</Text>
      {size !== null ? <Text style={styles.stateText}>{formatFileSize(size)}</Text> : null}
      {note ? <Text style={styles.stateText}>{note}</Text> : null}
      {action}
    </View>
  );
}
