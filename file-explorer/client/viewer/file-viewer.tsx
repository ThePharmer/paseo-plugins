import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { readFileRpc } from "../../shared/rpc";
import { ViewerHeader } from "./header";
import { ImageView } from "./image-view";
import { absolutePathOf, fileNameOf } from "./path";
import {
  countLines,
  resolveViewerContent,
  viewerContentSize,
  type ReadFileOutput,
  type ReadState,
  type ViewerContent,
} from "./presentation";
import { SourceView } from "./source-view";
import { ErrorState, LoadingState, UnviewableState } from "./states";
import { createViewerStyles, type ViewerStyles, type ViewerTheme } from "./styles";
import { useSaveAction, type SaveAction } from "./use-save-action";

// Interface contract shared by the tree/tabs code and the viewer. The viewer agent replaces the
// body; the props stay as they are.
export interface FileViewerProps {
  /** Expanded allowed-folder root, as returned by explorer.folders.list. */
  root: string;
  /** Path relative to root, "/"-separated. */
  path: string;
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
}

/**
 * Read-only file pane: highlighted source for text, a fitted preview for images, and a
 * Download/Share action for everything, modeled on core's file pane (packages/app/src/file-pane).
 */
export function FileViewer({ root, path, theme, layout }: FileViewerProps) {
  const readFile = useRpc(readFileRpc);
  const toast = useToast();
  const query = useQuery({
    queryKey: ["file-explorer", "viewer", root, path],
    queryFn: () => readFile({ root, path }),
    // The error state has its own Retry; silent retries only delay it.
    retry: false,
  });
  const stableTheme = useStableTheme(theme);
  const styles = useMemo(
    () => createViewerStyles(stableTheme, layout.compact),
    [stableTheme, layout.compact],
  );
  const fileName = fileNameOf(path);
  const absolutePath = absolutePathOf(root, path);
  const save = useSaveAction({ root, path, fileName, platform: layout.platform });

  const read = useMemo(() => readStateOf(query.data, query.error), [query.data, query.error]);
  const content = useMemo(
    () => resolveViewerContent(read, layout.platform),
    [read, layout.platform],
  );
  const lineCount = useMemo(
    () => (content.kind === "text" ? countLines(content.content) : null),
    [content],
  );

  const refetch = query.refetch;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const copyPath = useCallback(() => {
    async function copy() {
      try {
        await copyText(absolutePath);
        toast.show("Path copied", { variant: "success" });
      } catch {
        toast.error("Could not copy. Select the path and use Copy.");
      }
    }
    void copy();
  }, [absolutePath, toast]);

  return (
    <View style={styles.container}>
      <ViewerHeader
        fileName={fileName}
        absolutePath={absolutePath}
        size={viewerContentSize(content)}
        lineCount={lineCount}
        refreshing={query.isFetching}
        onRefresh={refresh}
        onCopyPath={copyPath}
        save={save}
        compact={layout.compact}
        theme={stableTheme}
        styles={styles}
      />
      <ViewerBody
        content={content}
        fileName={fileName}
        save={save}
        onRetry={refresh}
        retrying={query.isFetching}
        theme={stableTheme}
        styles={styles}
      />
    </View>
  );
}

/**
 * The same theme object for as long as its colors stay the same. Hosts may hand over a new theme
 * object for unchanged colors; a stable one keeps the source list's rows from re-rendering.
 */
function useStableTheme(theme: ViewerTheme): ViewerTheme {
  const {
    surface0,
    surface1,
    surface2,
    border,
    foreground,
    foregroundMuted,
    accent,
    accentForeground,
    statusSuccess,
    statusWarning,
    statusDanger,
  } = theme.colors;
  return useMemo(
    () => ({
      colors: {
        surface0,
        surface1,
        surface2,
        border,
        foreground,
        foregroundMuted,
        accent,
        accentForeground,
        statusSuccess,
        statusWarning,
        statusDanger,
      },
    }),
    [
      surface0,
      surface1,
      surface2,
      border,
      foreground,
      foregroundMuted,
      accent,
      accentForeground,
      statusSuccess,
      statusWarning,
      statusDanger,
    ],
  );
}

function readStateOf(data: ReadFileOutput | undefined, error: Error | null): ReadState {
  if (error) return { status: "failed", message: error.message };
  if (!data) return { status: "pending" };
  return { status: "done", output: data };
}

interface ViewerBodyProps {
  content: ViewerContent;
  fileName: string;
  save: SaveAction | null;
  onRetry(): void;
  retrying: boolean;
  theme: ViewerTheme;
  styles: ViewerStyles;
}

function ViewerBody({
  content,
  fileName,
  save,
  onRetry,
  retrying,
  theme,
  styles,
}: ViewerBodyProps) {
  const stateProps = { theme, styles };
  switch (content.kind) {
    case "loading":
      return <LoadingState {...stateProps} />;
    case "error":
      return (
        <ErrorState
          message={content.message}
          onRetry={onRetry}
          retrying={retrying}
          {...stateProps}
        />
      );
    case "too-large":
      return (
        <UnviewableState
          title="This file is too large to display"
          size={content.size}
          note={null}
          save={save}
          {...stateProps}
        />
      );
    case "text":
      return (
        <SourceView
          content={content.content}
          fileName={fileName}
          presentation={content.presentation}
          theme={theme}
          styles={styles}
        />
      );
    case "image":
      return <ImageBody uri={content.uri} size={content.size} save={save} {...stateProps} />;
    case "binary":
      return (
        <UnviewableState
          title="Binary preview unavailable"
          size={content.size}
          note={content.note}
          save={save}
          {...stateProps}
        />
      );
  }
}

function ImageBody({
  uri,
  size,
  save,
  theme,
  styles,
}: {
  uri: string;
  size: number;
  save: SaveAction | null;
  theme: ViewerTheme;
  styles: ViewerStyles;
}) {
  // Keyed by URI so a refreshed or different image gets a fresh attempt.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const handleError = useCallback(() => setFailedUri(uri), [uri]);
  if (failedUri === uri) {
    return (
      <UnviewableState
        title="This image could not be displayed"
        size={size}
        note={null}
        save={save}
        theme={theme}
        styles={styles}
      />
    );
  }
  return <ImageView uri={uri} onError={handleError} styles={styles} />;
}
