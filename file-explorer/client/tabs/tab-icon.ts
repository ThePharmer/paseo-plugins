// Lucide icon for a file's workspace tab. Tab icons are validated by name when the panel is
// registered and an unknown name throws, so every value here must exist in the app's
// lucide-react-native. All names were checked against lucide-react-native 1.50.0 (Paseo 0.11.1);
// FileJson, FileAudio and FileVideo are aliases there, kept because older releases export them.

export const FILE_TAB_ICONS = [
  "File",
  "FileArchive",
  "FileAudio",
  "FileCode",
  "FileCog",
  "FileImage",
  "FileJson",
  "FileKey",
  "FileLock",
  "FileSpreadsheet",
  "FileTerminal",
  "FileText",
  "FileVideo",
] as const;

export type FileTabIcon = (typeof FILE_TAB_ICONS)[number];

const ICON_BY_EXTENSION: Readonly<Record<string, FileTabIcon>> = {
  ...extensions("FileCode", [
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "kts",
    "swift",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "php",
    "scala",
    "lua",
    "dart",
    "ex",
    "exs",
    "erl",
    "hs",
    "clj",
    "zig",
    "nim",
    "r",
    "pl",
    "vue",
    "svelte",
    "astro",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "xml",
    "sql",
    "graphql",
    "gql",
    "proto",
  ]),
  ...extensions("FileTerminal", ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]),
  ...extensions("FileJson", ["json", "jsonc", "json5", "jsonl", "ndjson"]),
  ...extensions("FileText", ["md", "mdx", "markdown", "txt", "rst", "adoc", "log", "pdf", "rtf"]),
  ...extensions("FileImage", [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "avif",
    "tif",
    "tiff",
    "heic",
  ]),
  ...extensions("FileArchive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar"]),
  ...extensions("FileSpreadsheet", ["csv", "tsv", "xls", "xlsx", "ods"]),
  ...extensions("FileVideo", ["mp4", "mov", "mkv", "webm", "avi", "m4v"]),
  ...extensions("FileAudio", ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]),
  ...extensions("FileCog", ["yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties"]),
  ...extensions("FileKey", ["pem", "key", "crt", "cer", "p12", "pfx", "pub"]),
  ...extensions("FileLock", ["lock"]),
};

const ICON_BY_FILE_NAME: Readonly<Record<string, FileTabIcon>> = {
  dockerfile: "FileCode",
  makefile: "FileCode",
  justfile: "FileCode",
  license: "FileText",
  readme: "FileText",
};

export function fileTabIcon(fileName: string): FileTabIcon {
  const lower = fileName.toLowerCase();
  const byName = lookup(ICON_BY_FILE_NAME, lower);
  if (byName) return byName;
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "File";
  return lookup(ICON_BY_EXTENSION, lower.slice(dot + 1)) ?? "File";
}

function extensions(icon: FileTabIcon, list: readonly string[]): Record<string, FileTabIcon> {
  const map: Record<string, FileTabIcon> = {};
  for (const extension of list) map[extension] = icon;
  return map;
}

// Own-property lookup so names such as "constructor" never hit Object.prototype.
function lookup(record: Readonly<Record<string, FileTabIcon>>, key: string): FileTabIcon | null {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null;
}
