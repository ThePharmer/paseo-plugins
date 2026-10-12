import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { iconGlyphSize, type ViewerStyles, type ViewerTheme } from "./styles";

// The plugin runtime has no host Button or ToolbarButton, so these follow their look: an
// icon-only toolbar control with a surface highlight, and a small outline text button.

export interface IconButtonProps {
  icon: string;
  label: string;
  onPress(): void;
  busy?: boolean;
  disabled?: boolean;
  compact: boolean;
  theme: ViewerTheme;
  styles: ViewerStyles;
}

export function IconButton({
  icon,
  label,
  onPress,
  busy = false,
  disabled = false,
  compact,
  theme,
  styles,
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || busy;
  const glyphSize = iconGlyphSize(compact);
  const accessibilityState = useMemo(() => ({ disabled: isDisabled, busy }), [isDisabled, busy]);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.iconButton,
      (hovered || pressed) && !isDisabled ? styles.iconButtonHighlighted : null,
      disabled ? styles.disabled : null,
    ],
    [disabled, hovered, isDisabled, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      hitSlop={compact ? undefined : 6}
      style={pressableStyle}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      ) : (
        <Icon name={icon} size={glyphSize} color={iconColor(hovered, theme)} />
      )}
    </Pressable>
  );
}

function iconColor(hovered: boolean, theme: ViewerTheme): string {
  return hovered ? theme.colors.foreground : theme.colors.foregroundMuted;
}

export interface TextButtonProps {
  label: string;
  onPress(): void;
  icon?: string;
  busy?: boolean;
  disabled?: boolean;
  theme: ViewerTheme;
  styles: ViewerStyles;
}

export function TextButton({
  label,
  onPress,
  icon,
  busy = false,
  disabled = false,
  theme,
  styles,
}: TextButtonProps) {
  const isDisabled = busy || disabled;
  const accessibilityState = useMemo(() => ({ disabled: isDisabled, busy }), [isDisabled, busy]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.textButton,
      pressed ? styles.iconButtonHighlighted : null,
      disabled ? styles.disabled : null,
    ],
    [disabled, styles],
  );
  let leading: ReactNode = null;
  if (busy) {
    leading = <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />;
  } else if (icon) {
    leading = <Icon name={icon} size={14} color={theme.colors.foreground} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onPress={onPress}
      style={pressableStyle}
    >
      {leading ? <View>{leading}</View> : null}
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}
