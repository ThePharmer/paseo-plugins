import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginWorkspacePanelContribution } from "@getpaseo/plugin/client";
import type { OpenFile } from "../../shared/open-files";
import type { FallbackSelectionStore } from "./fallback-selection";
import type { LocalOpenFiles } from "./local-open-files";
import {
  MAX_OPEN_FILES,
  type OpenFilesStorage,
  persistOpenFile,
  readOpenFiles,
  recordOpenFile,
} from "./open-files";
import { fileKey, filePanelId, type FileRef } from "./panel-id";

// One workspace panel per opened file, registered at runtime so each file gets its own tab
// whose label and icon come from the panel. The app resolves a tab through the registered panel,
// so the registry keeps the set of panels equal to the persisted open-file list: creation
// registers this device's local copy of the list, restore adds the host's list, opening a file
// adds it, and the LRU cap unregisters what falls off. If runtime registration throws, files open
// in one shared "file" panel instead.
//
// A tab the app mounted before its panel existed keeps showing "Plugin unavailable" even after
// the panel is registered, so restored tabs only resolve through panels registered synchronously
// while contribute() runs. That is what the local copy is for; the host list arrives too late.

export const FALLBACK_PANEL_ID = "file";

export interface FileTabsHost {
  addWorkspacePanel(contribution: PluginWorkspacePanelContribution): PluginCleanup;
  openPanel(panelId: string, workspaceId: string): void;
  storage: OpenFilesStorage;
  /** This device's copy of the list, read synchronously when the registry is created. */
  local: LocalOpenFiles;
  now(): string;
}

export interface FileTabsPanels {
  filePanel(file: FileRef, panelId: string): PluginWorkspacePanelContribution;
  fallbackPanel(): PluginWorkspacePanelContribution;
}

export interface OpenFileTabInput extends FileRef {
  workspaceId: string;
}

export type OpenFileTabOutcome =
  | { tab: "file"; panelId: string; persisted: Promise<void> }
  | { tab: "fallback" };

export interface FileTabs {
  /**
   * Registers the host's list and drops panels pre-registered from the local copy that it does
   * not contain. Creation already registered the local copy, which restored tabs resolve through;
   * this adds what that copy missed, such as on a fresh device, and keeps the + menu in sync.
   */
  restore(): Promise<void>;
  /**
   * Opens (or focuses) the file's tab. The tab opens before anything is awaited; `persisted`
   * settles when the open-file list is saved and rejects with OpenFilesWriteError.
   */
  open(input: OpenFileTabInput): OpenFileTabOutcome;
  isRegistered(file: FileRef): boolean;
  /**
   * Marks the file's tab as showing on this client until the returned cleanup runs. Eviction
   * skips mounted files: the list is shared by every client on the host, so another client can
   * push out a file whose tab is open here.
   */
  trackMounted(file: FileRef): () => void;
  dispose(): void;
}

interface CreateFileTabsInput {
  host: FileTabsHost;
  panels: FileTabsPanels;
  fallback: FallbackSelectionStore;
}

export function createFileTabs({ host, panels, fallback }: CreateFileTabsInput): FileTabs {
  const registered = new Map<string, PluginCleanup>();
  // Files whose save is queued. A save that evicts one of them must not unregister it, because
  // the queued save puts it back at the front.
  const pending = new Map<string, number>();
  const mounted = new Map<string, number>();
  // Panels registered from the local copy that no host list has confirmed yet.
  const unconfirmed = new Set<string>();
  // Bumped whenever a save returns the host's list, so a restore read that started earlier does
  // not apply its older list over the newer one.
  let hostListVersion = 0;
  let removeFallback: PluginCleanup | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  function register(file: FileRef): boolean {
    const key = fileKey(file);
    if (registered.has(key)) return true;
    try {
      registered.set(key, host.addWorkspacePanel(panels.filePanel(file, filePanelId(file))));
      return true;
    } catch {
      // The host refused runtime registration (older app, invalid contribution). The caller
      // switches to the fallback panel; there is nothing to recover here.
      return false;
    }
  }

  function unregister(key: string): void {
    const remove = registered.get(key);
    if (!remove) return;
    registered.delete(key);
    remove();
  }

  function evict(previous: readonly OpenFile[], files: readonly OpenFile[]): void {
    const kept = new Set(files.map(fileKey));
    for (const file of previous) {
      const key = fileKey(file);
      if (!kept.has(key) && !pending.has(key) && !mounted.has(key)) unregister(key);
    }
  }

  /** Applies a list read from or saved to the host to the panels pre-registered from the copy. */
  function settleUnconfirmed(files: readonly OpenFile[]): void {
    const listed = new Set(files.map(fileKey));
    for (const key of unconfirmed) {
      if (!listed.has(key) && !pending.has(key) && !mounted.has(key)) unregister(key);
    }
    unconfirmed.clear();
  }

  function writeLocal(stored: readonly OpenFile[], files: readonly OpenFile[]): void {
    const next = files.slice(0, MAX_OPEN_FILES);
    if (!sameFiles(stored, next)) host.local.write(next);
  }

  /**
   * The local copy becomes the host's list, after any file this client is still saving and
   * before entries under roots the host does not list. Every host's installation on this device
   * shares the copy, and those entries are another host's.
   */
  function reconcileLocal(files: readonly OpenFile[]): void {
    const listed = new Set(files.map(fileKey));
    const roots = new Set(files.map((file) => file.root));
    const stored = host.local.readSync() ?? [];
    const unlisted = stored.filter((file) => !listed.has(fileKey(file)));
    writeLocal(stored, [
      ...unlisted.filter((file) => pending.has(fileKey(file))),
      ...files,
      ...unlisted.filter((file) => !pending.has(fileKey(file)) && !roots.has(file.root)),
    ]);
  }

  function persist(file: OpenFile): Promise<void> {
    const key = fileKey(file);
    pending.set(key, (pending.get(key) ?? 0) + 1);
    async function save(): Promise<void> {
      try {
        const saved = await persistOpenFile(host.storage, file);
        if (!disposed) {
          hostListVersion += 1;
          evict(saved.previous, saved.files);
          settleUnconfirmed(saved.files);
          reconcileLocal(saved.files);
        }
      } finally {
        const count = (pending.get(key) ?? 1) - 1;
        if (count === 0) pending.delete(key);
        else pending.set(key, count);
      }
    }
    const run = queue.then(save);
    queue = run.catch(() => undefined);
    return run;
  }

  function openInFallback(input: OpenFileTabInput): OpenFileTabOutcome {
    removeFallback ??= host.addWorkspacePanel(panels.fallbackPanel());
    fallback.set(input.workspaceId, { root: input.root, path: input.path });
    host.openPanel(FALLBACK_PANEL_ID, input.workspaceId);
    return { tab: "fallback" };
  }

  for (const file of host.local.readSync() ?? []) {
    if (register(file)) unconfirmed.add(fileKey(file));
  }

  return {
    async restore() {
      const version = hostListVersion;
      const files = await readOpenFiles(host.storage);
      if (disposed) return;
      for (const file of files) register(file);
      if (version !== hostListVersion) return;
      settleUnconfirmed(files);
      reconcileLocal(files);
    },

    open(input) {
      if (disposed) throw new Error("File tabs were disposed");
      const file: FileRef = { root: input.root, path: input.path };
      const key = fileKey(file);
      const isNew = !registered.has(key);
      if (!register(file)) return openInFallback(input);
      const panelId = filePanelId(file);
      try {
        host.openPanel(panelId, input.workspaceId);
      } catch (error) {
        // Nothing will persist a panel that never opened; do not leave it registered.
        if (isNew) unregister(key);
        throw error;
      }
      unconfirmed.delete(key);
      const entry: OpenFile = { ...file, openedAt: host.now() };
      const stored = host.local.readSync() ?? [];
      writeLocal(stored, recordOpenFile(stored, entry));
      return { tab: "file", panelId, persisted: persist(entry) };
    },

    isRegistered: (file) => registered.has(fileKey(file)),

    trackMounted(file) {
      const key = fileKey(file);
      mounted.set(key, (mounted.get(key) ?? 0) + 1);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const count = (mounted.get(key) ?? 1) - 1;
        if (count === 0) mounted.delete(key);
        else mounted.set(key, count);
      };
    },

    dispose() {
      disposed = true;
      for (const key of registered.keys()) unregister(key);
      removeFallback?.();
      removeFallback = null;
    },
  };
}

function sameFiles(left: readonly OpenFile[], right: readonly OpenFile[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        fileKey(file) === fileKey(right[index]) && file.openedAt === right[index].openedAt,
    )
  );
}
