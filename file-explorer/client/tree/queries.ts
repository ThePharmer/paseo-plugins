import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  type AllowedFolder,
  type FileExplorerDirectory,
  listDirectoryRpc,
  listFoldersRpc,
} from "../../shared/rpc";
import { explorerSettings } from "../../shared/settings";
import type { DirectoryLoadState } from "./rows";

// Each directory listing is its own query keyed by (root, path), so expanding a folder loads
// only that folder and a refresh refetches only what is on screen.

export const explorerQueryKeys = {
  all: ["explorer"] as const,
  folders: (settingsRevision: string | null) => ["explorer", "folders", settingsRevision] as const,
  directories: (root: string) => ["explorer", "directory", root] as const,
  directory: (root: string, path: string) => ["explorer", "directory", root, path] as const,
};

export class DirectoryListError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "DirectoryListError";
  }
}

export interface LoadedDirectories {
  directories: ReadonlyMap<string, FileExplorerDirectory>;
  states: ReadonlyMap<string, DirectoryLoadState>;
}

export function useAllowedFolders(): UseQueryResult<AllowedFolder[], Error> {
  const listFolders = useRpc(listFoldersRpc);
  // The host pushes settings changes to every client, but only refreshes the settings query.
  // Keying the folder list on the revision makes another client's edit show up here too.
  const settings = useSettings(explorerSettings);
  const revision =
    settings.status === "loading" || settings.status === "error" ? null : settings.revision;
  return useQuery({
    queryKey: explorerQueryKeys.folders(revision),
    queryFn: async () => (await listFolders({})).folders,
  });
}

export function useDirectories(root: string, paths: readonly string[]): LoadedDirectories {
  const listDirectory = useRpc(listDirectoryRpc);
  const combine = useCallback(
    (results: UseQueryResult<FileExplorerDirectory, Error>[]): LoadedDirectories => {
      const directories = new Map<string, FileExplorerDirectory>();
      const states = new Map<string, DirectoryLoadState>();
      results.forEach((result, index) => {
        const path = paths[index];
        if (result.data) directories.set(path, result.data);
        states.set(path, directoryLoadState(result));
      });
      return { directories, states };
    },
    [paths],
  );
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: explorerQueryKeys.directory(root, path),
      queryFn: async () => {
        const result = await listDirectory({ root, path });
        if (result.status === "error") throw new DirectoryListError(path, result.error);
        return result.directory;
      },
      // A listing failure is a fact about the folder (permissions, deleted), not a flaky
      // transport; show it at once and let Refresh retry.
      retry: false,
    })),
    combine,
  });
}

function directoryLoadState(
  result: UseQueryResult<FileExplorerDirectory, Error>,
): DirectoryLoadState {
  if (result.isPending) return { status: "loading" };
  if (result.isError) return { status: "error", error: result.error.message };
  return { status: "ready" };
}
