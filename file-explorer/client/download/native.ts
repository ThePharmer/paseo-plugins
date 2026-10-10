import { decodeBase64 } from "./base64";
import { sanitizeFileName } from "./file-name";
import type { SaveFileResult } from "./save-file";
import type { ChunkSink, DownloadedFile } from "./transfer";

// Plugin code cannot import expo-file-system or expo-sharing, but the Paseo app ships both and
// registers their native modules on globalThis.expo.modules, where expo-modules-core's
// requireNativeModule finds them. Method names and argument shapes below were checked against
// expo-file-system 19.0.21 and expo-sharing 14.0.8 (iOS and Android sources). Everything read from
// there is untyped, so it is validated here before use.

export type NativePlatform = "ios" | "android";

interface ExpoFileHandle {
  writeBytes(bytes: Uint8Array): void;
  close(): void;
}

interface ExpoFile {
  create(options: { intermediates: boolean; overwrite: boolean }): void;
  open(): ExpoFileHandle;
}

interface ExpoDirectory {
  readonly exists: boolean;
  delete(): void;
}

/** expo-file-system's current module ("FileSystem"): synchronous file handles, so chunks stream. */
interface ExpoFileSystemModule {
  cacheDirectory: string;
  FileSystemFile: new (uri: string) => unknown;
  FileSystemDirectory: new (uri: string) => unknown;
}

/** expo-file-system's legacy module ("ExponentFileSystem"): no append, so it writes once. */
interface ExpoLegacyFileSystemModule {
  cacheDirectory: string;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  writeAsStringAsync(uri: string, contents: string, options: { encoding: "base64" }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}

interface ExpoSharingModule {
  shareAsync(
    uri: string,
    options: { mimeType: string; dialogTitle: string; UTI?: string },
  ): Promise<void>;
}

export type NativeSaveMethod =
  | { kind: "expo-file"; fileSystem: ExpoFileSystemModule; sharing: ExpoSharingModule }
  | { kind: "expo-legacy"; fileSystem: ExpoLegacyFileSystemModule; sharing: ExpoSharingModule }
  // iOS only: React Native's Share turns a data: URL into NSData for the share sheet.
  | { kind: "share-data-url" };

export type DataUrlShareOutcome = "shared" | "dismissed";

export interface NativeSinkDeps {
  /** React Native's Share.share with a data: URL. Injected so this module stays testable. */
  shareDataUrl(input: { url: string; title: string }): Promise<DataUrlShareOutcome>;
  createId(): string;
  /**
   * Cache directories from earlier shares. They are deleted at the start of the next save rather
   * than right after sharing: Android's share target can still be reading the file when the
   * chooser returns.
   */
  sharedDirectories: string[];
}

const CACHE_FOLDER = "paseo-file-explorer/";

/** The globalThis.expo.modules host object, or undefined outside an Expo app. */
export function readExpoModules(): unknown {
  return readProperty(readProperty(globalThis, "expo"), "modules");
}

/** The best available way to hand a downloaded file to the OS on this device, or null. */
export function resolveNativeSaveMethod(
  platform: NativePlatform,
  modules: unknown,
): NativeSaveMethod | null {
  const sharing = readProperty(modules, "ExpoSharing");
  if (isSharingModule(sharing)) {
    const fileSystem = readProperty(modules, "FileSystem");
    if (isFileSystemModule(fileSystem)) {
      return { kind: "expo-file", fileSystem, sharing };
    }
    const legacy = readProperty(modules, "ExponentFileSystem");
    if (isLegacyFileSystemModule(legacy)) {
      return { kind: "expo-legacy", fileSystem: legacy, sharing };
    }
  }
  return platform === "ios" ? { kind: "share-data-url" } : null;
}

export function createNativeSink(method: NativeSaveMethod, deps: NativeSinkDeps): ChunkSink {
  switch (method.kind) {
    case "expo-file":
      return createExpoFileSink(method.fileSystem, method.sharing, deps);
    case "expo-legacy":
      return createExpoLegacySink(method.fileSystem, method.sharing, deps);
    case "share-data-url":
      return createDataUrlSink(deps);
  }
}

interface ShareTarget {
  directory: string;
  uri: string;
  file: DownloadedFile;
}

function shareTarget(cacheDirectory: string, file: DownloadedFile, id: string): ShareTarget {
  const base = cacheDirectory.endsWith("/") ? cacheDirectory : `${cacheDirectory}/`;
  // A fresh directory per save keeps the original file name, which the share target shows.
  const directory = `${base}${CACHE_FOLDER}${id}/`;
  return { directory, uri: directory + encodeURIComponent(sanitizeFileName(file.fileName)), file };
}

function shareOptions(file: DownloadedFile): { mimeType: string; dialogTitle: string } {
  return { mimeType: file.mimeType, dialogTitle: sanitizeFileName(file.fileName) };
}

function createExpoFileSink(
  fileSystem: ExpoFileSystemModule,
  sharing: ExpoSharingModule,
  deps: NativeSinkDeps,
): ChunkSink {
  let target: ShareTarget | null = null;
  let handle: ExpoFileHandle | null = null;

  function deleteDirectory(uri: string): void {
    const directory = new fileSystem.FileSystemDirectory(uri);
    if (isDirectory(directory) && directory.exists) directory.delete();
  }

  function closeHandle(): void {
    const open = handle;
    handle = null;
    open?.close();
  }

  return {
    async begin(file) {
      pruneSharedDirectories(deps.sharedDirectories, deleteDirectory);
      target = shareTarget(fileSystem.cacheDirectory, file, deps.createId());
      const created = new fileSystem.FileSystemFile(target.uri);
      if (!isFile(created)) {
        throw new Error("This Paseo app's file system module is not supported");
      }
      created.create({ intermediates: true, overwrite: true });
      const opened = created.open();
      if (!isFileHandle(opened)) {
        throw new Error("This Paseo app's file system module is not supported");
      }
      handle = opened;
    },
    async append(base64) {
      if (!handle) throw new Error("Download was not started");
      handle.writeBytes(decodeBase64(base64));
    },
    async finish() {
      if (!target) throw new Error("Download was not started");
      closeHandle();
      deps.sharedDirectories.push(target.directory);
      await sharing.shareAsync(target.uri, shareOptions(target.file));
      return { status: "saved" };
    },
    async abort() {
      closeHandle();
      if (target) deleteDirectory(target.directory);
    },
  };
}

function createExpoLegacySink(
  fileSystem: ExpoLegacyFileSystemModule,
  sharing: ExpoSharingModule,
  deps: NativeSinkDeps,
): ChunkSink {
  let target: ShareTarget | null = null;
  const parts = createBase64Parts();

  async function deleteDirectory(uri: string): Promise<void> {
    await fileSystem.deleteAsync(uri, { idempotent: true });
  }

  return {
    async begin(file) {
      await pruneSharedDirectoriesAsync(deps.sharedDirectories, deleteDirectory);
      target = shareTarget(fileSystem.cacheDirectory, file, deps.createId());
      await fileSystem.makeDirectoryAsync(target.directory, { intermediates: true });
    },
    async append(base64) {
      parts.push(base64);
    },
    async finish() {
      if (!target) throw new Error("Download was not started");
      await fileSystem.writeAsStringAsync(target.uri, parts.join(), { encoding: "base64" });
      deps.sharedDirectories.push(target.directory);
      await sharing.shareAsync(target.uri, shareOptions(target.file));
      return { status: "saved" };
    },
    async abort() {
      if (target) await deleteDirectory(target.directory);
    },
  };
}

function createDataUrlSink(deps: NativeSinkDeps): ChunkSink {
  let file: DownloadedFile | null = null;
  const parts = createBase64Parts();
  return {
    async begin(downloaded) {
      file = downloaded;
    },
    async append(base64) {
      parts.push(base64);
    },
    async finish(): Promise<SaveFileResult> {
      if (!file) throw new Error("Download was not started");
      const outcome = await deps.shareDataUrl({
        url: `data:${file.mimeType};base64,${parts.join()}`,
        title: sanitizeFileName(file.fileName),
      });
      return outcome === "dismissed" ? { status: "cancelled" } : { status: "saved" };
    },
    async abort() {},
  };
}

interface Base64Parts {
  push(base64: string): void;
  join(): string;
}

/**
 * Base64 chunks that concatenate into one valid string. Only the last chunk may carry padding;
 * DOWNLOAD_CHUNK_BYTES is a multiple of 3 so the server never pads earlier ones.
 */
function createBase64Parts(): Base64Parts {
  const parts: string[] = [];
  return {
    push(base64) {
      if (parts.at(-1)?.endsWith("=")) {
        throw new Error("Received a short chunk in the middle of the file");
      }
      parts.push(base64);
    },
    join() {
      return parts.join("");
    },
  };
}

function pruneSharedDirectories(directories: string[], remove: (uri: string) => void): void {
  for (const uri of directories.splice(0)) {
    try {
      remove(uri);
    } catch {
      // Stale cache folders are best effort; the OS also purges the cache directory.
    }
  }
}

async function pruneSharedDirectoriesAsync(
  directories: string[],
  remove: (uri: string) => Promise<void>,
): Promise<void> {
  for (const uri of directories.splice(0)) {
    try {
      await remove(uri);
    } catch {
      // Stale cache folders are best effort; the OS also purges the cache directory.
    }
  }
}

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return property;
}

function hasMethods(value: unknown, names: readonly string[]): boolean {
  return names.every((name) => typeof readProperty(value, name) === "function");
}

function isConstructor(value: unknown): value is new (uri: string) => unknown {
  return typeof value === "function";
}

function isSharingModule(value: unknown): value is ExpoSharingModule {
  return hasMethods(value, ["shareAsync"]);
}

function isFileSystemModule(value: unknown): value is ExpoFileSystemModule {
  return (
    typeof readProperty(value, "cacheDirectory") === "string" &&
    isConstructor(readProperty(value, "FileSystemFile")) &&
    isConstructor(readProperty(value, "FileSystemDirectory"))
  );
}

function isLegacyFileSystemModule(value: unknown): value is ExpoLegacyFileSystemModule {
  return (
    typeof readProperty(value, "cacheDirectory") === "string" &&
    hasMethods(value, ["makeDirectoryAsync", "writeAsStringAsync", "deleteAsync"])
  );
}

function isFile(value: unknown): value is ExpoFile {
  return hasMethods(value, ["create", "open"]);
}

function isFileHandle(value: unknown): value is ExpoFileHandle {
  return hasMethods(value, ["writeBytes", "close"]);
}

function isDirectory(value: unknown): value is ExpoDirectory {
  return hasMethods(value, ["delete"]);
}
