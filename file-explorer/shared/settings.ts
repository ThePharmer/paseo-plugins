import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const AllowedFolderSettingSchema = z.object({
  // Absolute, or starting with ~/ for the daemon user's home directory.
  path: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
});

export const explorerSettings = defineSettings({
  id: "explorer",
  scope: "host",
  version: 1,
  schema: z.object({
    folders: z.array(AllowedFolderSettingSchema).default([]),
  }),
});

export type AllowedFolderSetting = z.infer<typeof AllowedFolderSettingSchema>;
