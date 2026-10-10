import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createExplorerHandlers } from "./server/handlers";
import { listDirectoryRpc, listFoldersRpc, readFileChunkRpc, readFileRpc } from "./shared/rpc";
import { openFilesSettings } from "./shared/open-files";
import { explorerSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(explorerSettings);
  server.registerSettings(openFilesSettings);
  const handlers = createExplorerHandlers(settings);
  server.handle(listFoldersRpc, handlers.listFolders);
  server.handle(listDirectoryRpc, handlers.listDirectory);
  server.handle(readFileRpc, handlers.readFile);
  server.handle(readFileChunkRpc, handlers.readFileChunk);
  return () => {};
}
