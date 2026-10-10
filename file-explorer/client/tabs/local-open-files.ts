import { z } from "zod";
import { type OpenFile, OpenFileSchema } from "../../shared/open-files";
import { readExpoModules } from "../download/native";
import { createExpoSqliteTextStore } from "./sqlite-text-store";
import { MAX_OPEN_FILES } from "./open-files";
import { fileKey } from "./panel-id";

// This device's copy of the open-file list. The host document arrives over an async RPC, which
// lands after the app has mounted the restored tabs, and a panel registered then never reaches
// them. A synchronous local read lets contribute() register those panels before it returns.
//
// The plugin cannot see which host its installation belongs to while contribute() runs, so every
// host shares one key. That only widens which panels get pre-registered: the registry drops the
// ones the host's own list does not contain once that list arrives.

export const LOCAL_OPEN_FILES_KEY = "paseo-plugin:file-explorer:open-files:v1";

export interface LocalOpenFiles {
  /** The stored list, or null when there is none, it is unreadable, or storage is unavailable. */
  readSync(): OpenFile[] | null;
  /** Best effort: a failed write is dropped. */
  write(files: readonly OpenFile[]): void;
}

/** Synchronous string storage. Implementations may throw; LocalOpenFiles contains it. */
export interface TextStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface TextStoreSources {
  webStorage(): unknown;
  expoModules(): unknown;
}

const LocalDocumentSchema = z.object({ files: z.array(OpenFileSchema) });

export function createLocalOpenFiles(store: TextStore | null): LocalOpenFiles {
  return {
    readSync() {
      if (!store) return null;
      try {
        return parseLocalOpenFiles(store.read(LOCAL_OPEN_FILES_KEY));
      } catch {
        return null;
      }
    },
    write(files) {
      if (!store) return;
      try {
        store.write(LOCAL_OPEN_FILES_KEY, serializeLocalOpenFiles(files));
      } catch {
        // Losing the local copy only costs the next reload its pre-registered panels.
      }
    },
  };
}

/** Most recent first, one entry per file, at most MAX_OPEN_FILES. */
export function parseLocalOpenFiles(text: string | null): OpenFile[] | null {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = LocalDocumentSchema.safeParse(json);
  return parsed.success ? capOpenFiles(parsed.data.files) : null;
}

export function serializeLocalOpenFiles(files: readonly OpenFile[]): string {
  return JSON.stringify({ files: capOpenFiles(files) });
}

function capOpenFiles(files: readonly OpenFile[]): OpenFile[] {
  const seen = new Set<string>();
  const unique: OpenFile[] = [];
  for (const file of files) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ root: file.root, path: file.path, openedAt: file.openedAt });
  }
  return unique.slice(0, MAX_OPEN_FILES);
}

/** localStorage on web and Electron, the plugin's own SQLite file on iOS and Android. */
export function resolveTextStore(platform: string, sources: TextStoreSources): TextStore | null {
  if (platform === "web") return createWebTextStore(sources.webStorage());
  if (platform === "ios" || platform === "android") {
    return createExpoSqliteTextStore(sources.expoModules());
  }
  return null;
}

export function createWebTextStore(storage: unknown): TextStore | null {
  if (!isWebStorage(storage)) return null;
  return {
    read(key) {
      const value: unknown = storage.getItem(key);
      return typeof value === "string" ? value : null;
    },
    write: (key, value) => storage.setItem(key, value),
  };
}

// The plugin typechecks without the DOM library. Reading localStorage throws when the browser
// blocks storage, so the read is guarded as well as the type check.
declare const localStorage: unknown;

export function readWebStorage(): unknown {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const defaultTextStoreSources: TextStoreSources = {
  webStorage: readWebStorage,
  expoModules: readExpoModules,
};

interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isWebStorage(value: unknown): value is WebStorage {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "getItem") === "function" &&
    typeof Reflect.get(value, "setItem") === "function"
  );
}
