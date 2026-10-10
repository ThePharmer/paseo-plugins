import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Files opened as workspace tabs, most recent first. The client registers one workspace panel per
// entry at startup so tabs restored from a previous session resolve instead of showing
// "Plugin unavailable". This is disposable UI state, not configuration.

export const OpenFileSchema = z.object({
  /** Expanded allowed-folder root, as returned by explorer.folders.list. */
  root: z.string().min(1),
  /** Path relative to root, "/"-separated. */
  path: z.string().min(1),
  /** ISO timestamp of the last open. */
  openedAt: z.string(),
});

export const openFilesSettings = defineSettings({
  id: "open-files",
  scope: "host",
  version: 1,
  schema: z.object({
    files: z.array(OpenFileSchema).default([]),
  }),
});

export const openFilesRpc = settingsRpc(openFilesSettings.id);

export type OpenFile = z.infer<typeof OpenFileSchema>;
export type OpenFilesValues = z.infer<(typeof openFilesSettings)["schema"]>;
