import { useRpc } from "@getpaseo/plugin/client";
import { useToast, type ToastApi } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { readFileChunkRpc } from "../../shared/rpc";
import {
  canSaveFiles,
  saveFile,
  type ClientPlatform,
  type SaveFileResult,
} from "../download/save-file";

export type SaveProgress = { status: "idle" } | { status: "transferring"; percent: number };

export interface SaveAction {
  /** Download on web and desktop, Share on iOS and Android. */
  label: "Download" | "Share";
  icon: string;
  progress: SaveProgress;
  start(): void;
}

/** The Download/Share action for one file, or null when this client cannot save files. */
export function useSaveAction(input: {
  root: string;
  path: string;
  fileName: string;
  platform: ClientPlatform;
}): SaveAction | null {
  const { root, path, fileName, platform } = input;
  const readChunk = useRpc(readFileChunkRpc);
  const toast = useToast();
  const available = useMemo(() => canSaveFiles(platform), [platform]);
  const [progress, setProgress] = useState<SaveProgress>({ status: "idle" });
  // Blocks a second start while bytes are still arriving. Not state: it never affects rendering.
  const transferring = useRef(false);
  const label = platform === "web" ? "Download" : "Share";

  const start = useCallback(() => {
    if (transferring.current) return;
    transferring.current = true;
    setProgress({ status: "transferring", percent: 0 });

    function finishTransfer() {
      transferring.current = false;
      setProgress({ status: "idle" });
    }

    void saveFile({
      root,
      path,
      readChunk,
      platform,
      onProgress(received, total) {
        // The control frees up once every byte is here. iOS's share sheet never settles its
        // promise when the user opens a share target and backs out, so waiting for the result
        // could leave the control stuck.
        if (received >= total) {
          finishTransfer();
          return;
        }
        setProgress({ status: "transferring", percent: Math.floor((received / total) * 100) });
      },
    }).then((result) => {
      finishTransfer();
      reportResult({ result, fileName, label, toast });
    });
  }, [fileName, label, path, platform, readChunk, root, toast]);

  if (!available) return null;
  return { label, icon: shareIcon(platform), progress, start };
}

function shareIcon(platform: ClientPlatform): string {
  if (platform === "web") return "Download";
  return platform === "ios" ? "Share" : "Share2";
}

function reportResult(input: {
  result: SaveFileResult;
  fileName: string;
  label: SaveAction["label"];
  toast: ToastApi;
}) {
  const { result, fileName, label, toast } = input;
  switch (result.status) {
    case "saved":
      // The browser owns the file from here. On native the share sheet is the confirmation, and a
      // dismissal looks the same as a share.
      if (label === "Download") toast.show(`Download started: ${fileName}`, { variant: "success" });
      return;
    case "cancelled":
      return;
    case "unavailable":
      toast.show(result.reason, { variant: "warning" });
      return;
    case "error":
      toast.error(`${label} failed: ${result.error}`);
      return;
  }
}
