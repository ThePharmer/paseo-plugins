import type { FileRef } from "./panel-id";

// The single "file" panel used when per-file panels cannot be registered shows whichever file
// was opened last in its workspace. The selection is in-memory: after a reload the panel shows
// its empty state until a file is opened again.

export interface FallbackSelectionStore {
  get(workspaceId: string): FileRef | null;
  set(workspaceId: string, file: FileRef): void;
  subscribe(listener: () => void): () => void;
}

export function createFallbackSelectionStore(): FallbackSelectionStore {
  const selections = new Map<string, FileRef>();
  const listeners = new Set<() => void>();
  return {
    get: (workspaceId) => selections.get(workspaceId) ?? null,
    set(workspaceId, file) {
      selections.set(workspaceId, file);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
