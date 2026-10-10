import { decodeBase64 } from "./base64";
import { sanitizeFileName } from "./file-name";
import type { ChunkSink, DownloadedFile } from "./transfer";

// Web-only (browser and Electron). The plugin typechecks without the DOM library, so declare only
// what this module uses. These shadow React Native's narrower Blob and URL globals, whose Blob
// constructor does not accept byte arrays. Never call into this module on native.
interface BrowserBlob {
  readonly size: number;
}

interface AnchorElement {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
}

declare const document:
  | {
      createElement(tag: "a"): AnchorElement;
      body: { appendChild(node: AnchorElement): unknown };
    }
  | undefined;
declare const Blob: new (parts: Uint8Array[], options: { type: string }) => BrowserBlob;
declare const URL: {
  createObjectURL(blob: BrowserBlob): string;
  revokeObjectURL(url: string): void;
};

// Revoking in the same task as click() cancels the download in some browsers.
const REVOKE_DELAY_MS = 60_000;

export function hasDocument(): boolean {
  return typeof document !== "undefined";
}

/** Collects decoded chunks, then hands one Blob to the browser through a temporary download link. */
export function createBrowserSink(): ChunkSink {
  let file: DownloadedFile | null = null;
  const chunks: Uint8Array[] = [];
  return {
    async begin(downloaded) {
      file = downloaded;
    },
    async append(base64) {
      chunks.push(decodeBase64(base64));
    },
    async finish() {
      if (!file || typeof document === "undefined") throw new Error("Download was not started");
      const url = URL.createObjectURL(new Blob(chunks, { type: file.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = sanitizeFileName(file.fileName);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
      return { status: "saved" };
    },
    async abort() {
      chunks.length = 0;
    },
  };
}
