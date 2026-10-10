import { describe, expect, it } from "vitest";
import type { OpenFile } from "../../shared/open-files";
import {
  createLocalOpenFiles,
  createWebTextStore,
  LOCAL_OPEN_FILES_KEY,
  parseLocalOpenFiles,
  resolveTextStore,
  type TextStore,
} from "./local-open-files";
import { MAX_OPEN_FILES } from "./open-files";

function openFile(path: string, root = "/r"): OpenFile {
  return { root, path, openedAt: "2026-10-01T00:00:00.000Z" };
}

/** Mirrors the Storage methods the module uses; can stand in for blocked storage. */
class FakeLocalStorage {
  items = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("SecurityError");
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
}

function webLocal(storage: FakeLocalStorage) {
  return createLocalOpenFiles(createWebTextStore(storage));
}

describe("parseLocalOpenFiles", () => {
  it("reads a stored list", () => {
    const files = [openFile("a"), openFile("b")];
    expect(parseLocalOpenFiles(JSON.stringify({ files }))).toEqual(files);
  });

  it("returns null for missing, malformed, or invalid data", () => {
    expect(parseLocalOpenFiles(null)).toBeNull();
    expect(parseLocalOpenFiles("{not json")).toBeNull();
    expect(parseLocalOpenFiles("null")).toBeNull();
    expect(parseLocalOpenFiles(JSON.stringify({ files: "a" }))).toBeNull();
    expect(parseLocalOpenFiles(JSON.stringify({ files: [{ root: "/r", path: "" }] }))).toBeNull();
    expect(parseLocalOpenFiles(JSON.stringify([openFile("a")]))).toBeNull();
  });

  it("caps the list and drops repeated files, keeping the first", () => {
    const files = Array.from({ length: MAX_OPEN_FILES + 5 }, (_, index) => openFile(`f${index}`));
    const repeated = { ...openFile("f0"), openedAt: "2020-01-01T00:00:00.000Z" };

    const parsed = parseLocalOpenFiles(JSON.stringify({ files: [files[0], repeated, ...files] }));

    expect(parsed).toHaveLength(MAX_OPEN_FILES);
    expect(parsed?.[0]).toEqual(files[0]);
    expect(parsed?.[1]).toEqual(files[1]);
  });

  it("strips unknown fields", () => {
    const parsed = parseLocalOpenFiles(
      JSON.stringify({ files: [{ ...openFile("a"), extra: true }], other: 1 }),
    );
    expect(parsed).toEqual([openFile("a")]);
  });
});

describe("createLocalOpenFiles over localStorage", () => {
  it("round-trips the list under the plugin's key, capped", () => {
    const storage = new FakeLocalStorage();
    const local = webLocal(storage);
    const files = Array.from({ length: MAX_OPEN_FILES + 1 }, (_, index) => openFile(`f${index}`));

    local.write(files);

    expect([...storage.items.keys()]).toEqual([LOCAL_OPEN_FILES_KEY]);
    expect(local.readSync()).toEqual(files.slice(0, MAX_OPEN_FILES));
  });

  it("reads null when nothing is stored or the stored value is corrupt", () => {
    const storage = new FakeLocalStorage();
    const local = webLocal(storage);
    expect(local.readSync()).toBeNull();

    storage.items.set(LOCAL_OPEN_FILES_KEY, "{");
    expect(local.readSync()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const storage = new FakeLocalStorage();
    const local = webLocal(storage);
    local.write([openFile("a")]);
    storage.failReads = true;
    storage.failWrites = true;

    expect(local.readSync()).toBeNull();
    expect(() => local.write([openFile("b")])).not.toThrow();
  });

  it("is unavailable without a storage object", () => {
    expect(createWebTextStore(undefined)).toBeNull();
    expect(createWebTextStore({ getItem: () => null })).toBeNull();
    const local = createLocalOpenFiles(null);
    expect(local.readSync()).toBeNull();
    expect(() => local.write([openFile("a")])).not.toThrow();
  });

  it("ignores a storage that returns something other than a string", () => {
    const local = createLocalOpenFiles(
      createWebTextStore({ getItem: () => ({ files: [] }), setItem: () => undefined }),
    );
    expect(local.readSync()).toBeNull();
  });
});

describe("createLocalOpenFiles over a throwing store", () => {
  it("contains every failure", () => {
    const store: TextStore = {
      read() {
        throw new Error("native failure");
      },
      write() {
        throw new Error("native failure");
      },
    };
    const local = createLocalOpenFiles(store);
    expect(local.readSync()).toBeNull();
    expect(() => local.write([openFile("a")])).not.toThrow();
  });
});

describe("resolveTextStore", () => {
  const storage = new FakeLocalStorage();
  const sources = { webStorage: () => storage, expoModules: () => undefined };

  it("uses localStorage on web and Electron", () => {
    const store = resolveTextStore("web", sources);
    store?.write("k", "v");
    expect(storage.items.get("k")).toBe("v");
  });

  it("uses expo-sqlite on iOS and Android, and nothing when it is missing", () => {
    expect(resolveTextStore("ios", sources)).toBeNull();
    expect(resolveTextStore("android", sources)).toBeNull();
  });

  it("has no store on other platforms", () => {
    expect(resolveTextStore("windows", sources)).toBeNull();
  });
});
