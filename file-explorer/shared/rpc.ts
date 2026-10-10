import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Payload shapes mirror Paseo's file explorer protocol (packages/protocol/src/messages.ts,
// FileExplorerEntrySchema and FileExplorerFileSchema) so ported client code keeps working.

const FileExplorerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number(),
  modifiedAt: z.string(),
});

const FileExplorerDirectorySchema = z.object({
  path: z.string(),
  entries: z.array(FileExplorerEntrySchema),
});

const FileExplorerFileSchema = z.object({
  path: z.string(),
  kind: z.enum(["text", "image", "binary"]),
  encoding: z.enum(["utf-8", "base64", "none"]),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number(),
  modifiedAt: z.string(),
  revision: z.string(),
});

const ErrorResultSchema = z.object({ status: z.literal("error"), error: z.string() });

export const AllowedFolderSchema = z.object({
  // Expanded absolute path. Clients send it back as `root` to identify the folder.
  root: z.string(),
  label: z.string(),
  status: z.enum(["ready", "missing", "not-directory"]),
});

export const listFoldersRpc = defineRpc({
  name: "explorer.folders.list",
  input: z.object({}),
  output: z.object({ folders: z.array(AllowedFolderSchema) }),
});

export const listDirectoryRpc = defineRpc({
  name: "explorer.directory.list",
  input: z.object({ root: z.string(), path: z.string().optional() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), directory: FileExplorerDirectorySchema }),
    ErrorResultSchema,
  ]),
});

export const readFileRpc = defineRpc({
  name: "explorer.file.read",
  input: z.object({
    root: z.string(),
    path: z.string(),
    maxBytes: z.number().int().positive().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), file: FileExplorerFileSchema }),
    ErrorResultSchema,
  ]),
});

// Raw bytes per chunk stay well under the relay's frame limit once base64 and encryption are
// added, and one chunk always finishes inside the daemon's 30 s plugin RPC timeout.
export const MAX_FILE_CHUNK_BYTES = 2 * 1024 * 1024;

// Downloads fetch a file in chunks. Pass the revision from the first chunk on later calls so a
// file that changes mid-download fails instead of mixing two versions.
export const readFileChunkRpc = defineRpc({
  name: "explorer.file.chunk",
  input: z.object({
    root: z.string(),
    path: z.string(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(MAX_FILE_CHUNK_BYTES),
    expectedRevision: z.string().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      base64: z.string(),
      size: z.number(),
      revision: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
    }),
    z.object({ status: z.literal("changed"), revision: z.string() }),
    ErrorResultSchema,
  ]),
});

export type AllowedFolder = z.infer<typeof AllowedFolderSchema>;
export type FileExplorerEntry = z.infer<typeof FileExplorerEntrySchema>;
export type FileExplorerDirectory = z.infer<typeof FileExplorerDirectorySchema>;
export type FileExplorerFile = z.infer<typeof FileExplorerFileSchema>;
