import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback } from "react";
import { readFileChunkRpc } from "../../shared/rpc";
import { type ClientPlatform, saveFile } from "../download/save-file";

// Progress replaces the previous toast, so announce it in steps rather than per chunk.
const PROGRESS_STEP_PERCENT = 10;
const PROGRESS_TOAST_MS = 60_000;

export interface SaveEntryInput {
  root: string;
  path: string;
  name: string;
}

/** Downloads (web) or shares (native) a file, reporting progress and the outcome as toasts. */
export function useSaveEntry(platform: ClientPlatform): (input: SaveEntryInput) => Promise<void> {
  const readChunk = useRpc(readFileChunkRpc);
  const toast = useToast();
  return useCallback(
    async ({ root, path, name }: SaveEntryInput) => {
      const verb = platform === "web" ? "Downloading" : "Preparing";
      let announced = -1;
      toast.show(`${verb} ${name}...`, { durationMs: PROGRESS_TOAST_MS });
      function onProgress(received: number, total: number) {
        if (total <= 0) return;
        const percent = Math.floor((received / total) * 100);
        const step = percent - (percent % PROGRESS_STEP_PERCENT);
        if (step <= announced || step === 100) return;
        announced = step;
        toast.show(`${verb} ${name}... ${step}%`, { durationMs: PROGRESS_TOAST_MS });
      }
      const action = platform === "web" ? "download" : "share";
      try {
        const result = await saveFile({ root, path, readChunk, platform, onProgress });
        switch (result.status) {
          case "saved":
            // On native the share sheet is the confirmation, and expo-sharing resolves the same
            // way whether the user shared or dismissed it.
            if (platform === "web") toast.show(`Downloaded ${name}`, { variant: "success" });
            return;
          case "cancelled":
            // Dismissing the share sheet is the user's answer; clear the progress toast quietly.
            toast.show("Cancelled", { durationMs: 1200 });
            return;
          case "unavailable":
            toast.error(result.reason);
            return;
          case "error":
            toast.error(`Unable to ${action} ${name}: ${result.error}`);
            return;
        }
      } catch (error) {
        // saveFile reports expected failures in its result; this is the user-visible end of an
        // unexpected throw, which would otherwise leave the progress toast up.
        toast.error(
          `Unable to ${action} ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [platform, readChunk, toast],
  );
}
