import { useMemo } from "react";
import { Image } from "react-native";
import { DEFAULT_FILE_ICON, EXTENSION_TO_ICON, FILE_ICON_URIS } from "./file-icons.generated";

function hasKey(record: Readonly<Record<string, string>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Same rule as core Paseo: text after the last dot, lowercased. No dot or a trailing dot is none. */
function getExtension(fileName: string): string | null {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1 || idx === fileName.length - 1) return null;
  return fileName.slice(idx + 1).toLowerCase();
}

/** The icon name for a file, falling back to the generic file icon. */
export function resolveFileIconName(fileName: string): string {
  const ext = getExtension(fileName);
  if (ext !== null && hasKey(EXTENSION_TO_ICON, ext)) {
    const icon = EXTENSION_TO_ICON[ext];
    if (hasKey(FILE_ICON_URIS, icon)) return icon;
  }
  return DEFAULT_FILE_ICON;
}

/** The PNG data URI for a file's icon. */
export function resolveFileIconUri(fileName: string): string {
  return FILE_ICON_URIS[resolveFileIconName(fileName)];
}

export interface FileIconProps {
  fileName: string;
  size: number;
}

/** A file-type icon matching the core Paseo file explorer. Files only; folders are the caller's. */
export function FileIcon({ fileName, size }: FileIconProps) {
  const uri = resolveFileIconUri(fileName);
  // Data URIs carry no intrinsic size on native, so width and height must be explicit.
  const source = useMemo(() => ({ uri, width: size, height: size }), [uri, size]);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image source={source} style={style} resizeMode="contain" accessible={false} />;
}
