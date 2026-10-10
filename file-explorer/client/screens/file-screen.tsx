import type { PluginScreenParams, PluginScreenProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { FileRef } from "../tabs/panel-id";
import { explorerBasename } from "../tree/paths";
import { FileViewer } from "../viewer/file-viewer";

export const FILE_SCREEN_ID = "file";

// Screen params live in the route's query string, so a reload or a shared link reopens the file.
export function fileScreenParams({ root, path }: FileRef): PluginScreenParams {
  return { root, path };
}

export function fileScreenTitle(params: PluginScreenParams): string {
  return params.path ? explorerBasename(params.path) : "File";
}

export function FileScreen({ params, theme, layout }: PluginScreenProps) {
  const { root, path } = params;
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
  if (!root || !path) {
    return (
      <View style={styles.empty}>
        <Text style={styles.text}>No file selected</Text>
      </View>
    );
  }
  return (
    <FileViewer key={`${root}\n${path}`} root={root} path={path} theme={theme} layout={layout} />
  );
}
