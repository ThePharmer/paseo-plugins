// Ported from getpaseo/paseo@ab10a6694ccf068959d1a6b67b6c915e21a9fe91 (v0.11.1)
// packages/app/src/file-pane/source/view.native.tsx (Apache-2.0, Copyright (c) 2025-present
// Mohamed Boudra).
// Modified: plain React Native styles from PluginTheme instead of Unistyles, the SDK FlatList,
// no line-target scrolling, row height and getItemLayout share one value, and token keys are
// positional so repeated tokens on a line do not collide.

import { highlightCode, type HighlightToken } from "@getpaseo/highlight";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { memo, useCallback, useMemo } from "react";
import { Text, View, type ListRenderItem } from "react-native";
import type { ViewerStyles, ViewerTheme } from "./styles";
import { colorSchemeForTheme, createTokenStyles, tokenStyleFor, type TokenStyles } from "./syntax";

export interface SourceViewProps {
  content: string;
  /** Picks the grammar by extension. */
  fileName: string;
  presentation: "highlighted" | "plain";
  theme: ViewerTheme;
  styles: ViewerStyles;
}

interface SourceLine {
  number: number;
  tokens: HighlightToken[];
}

export function SourceView({ content, fileName, presentation, theme, styles }: SourceViewProps) {
  const lines = useMemo(
    () => sourceLines({ content, fileName, presentation }),
    [content, fileName, presentation],
  );
  const { surface0, foreground } = theme.colors;
  const tokenStyles = useMemo(
    () => createTokenStyles(colorSchemeForTheme({ surface0, foreground }), foreground),
    [surface0, foreground],
  );
  const renderLine = useCallback<ListRenderItem<SourceLine>>(
    ({ item }) => <SourceLineView line={item} styles={styles} tokenStyles={tokenStyles} />,
    [styles, tokenStyles],
  );
  return (
    <FlatList
      style={styles.sourceList}
      data={lines}
      keyExtractor={sourceLineKey}
      initialNumToRender={24}
      windowSize={9}
      renderItem={renderLine}
    />
  );
}

function sourceLines(input: {
  content: string;
  fileName: string;
  presentation: "highlighted" | "plain";
}): SourceLine[] {
  if (input.presentation === "highlighted") {
    return highlightCode(input.content, input.fileName).map((tokens, index) => ({
      number: index + 1,
      tokens,
    }));
  }
  return input.content
    .split("\n")
    .map((text, index) => ({ number: index + 1, tokens: [{ text, style: null }] }));
}

const SourceLineView = memo(function SourceLineView({
  line,
  styles,
  tokenStyles,
}: {
  line: SourceLine;
  styles: ViewerStyles;
  tokenStyles: TokenStyles;
}) {
  return (
    <View style={styles.sourceLine}>
      <Text style={styles.gutter}>{line.number}</Text>
      <Text selectable style={styles.sourceText}>
        {line.tokens.map((token, index) => (
          // Tokens never reorder within a line, so their position is a stable key.
          <Text key={index} style={tokenStyleFor(tokenStyles, token.style)}>
            {token.text}
          </Text>
        ))}
      </Text>
    </View>
  );
});

function sourceLineKey(line: SourceLine): string {
  return String(line.number);
}
