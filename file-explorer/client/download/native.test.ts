import { describe, expect, it } from "vitest";
import {
  createNativeSink,
  resolveNativeSaveMethod,
  type DataUrlShareOutcome,
  type NativeSinkDeps,
} from "./native";
import { encodeBase64 } from "./test-support";

interface ShareCall {
  uri: string;
  options: unknown;
}

function fakeSharing() {
  const calls: ShareCall[] = [];
  return {
    calls,
    module: {
      async shareAsync(uri: string, options: unknown) {
        calls.push({ uri, options });
      },
    },
  };
}

function parentOf(uri: string): string {
  return uri.slice(0, uri.lastIndexOf("/") + 1);
}

/** Mirrors the methods of expo-file-system's native FileSystemFile and FileSystemDirectory. */
function fakeFileSystem() {
  const log: string[] = [];
  const files = new Map<string, number[]>();
  const directories = new Set<string>();

  class FakeFile {
    constructor(readonly uri: string) {}
    create(options: unknown) {
      log.push(`create ${this.uri} ${JSON.stringify(options)}`);
      directories.add(parentOf(this.uri));
    }
    open() {
      const uri = this.uri;
      const bytes: number[] = [];
      files.set(uri, bytes);
      return {
        writeBytes(chunk: Uint8Array) {
          bytes.push(...chunk);
        },
        close() {
          log.push(`close ${uri}`);
        },
      };
    }
  }

  class FakeDirectory {
    constructor(readonly uri: string) {}
    get exists() {
      return directories.has(this.uri);
    }
    delete() {
      log.push(`delete ${this.uri}`);
      directories.delete(this.uri);
    }
  }

  return {
    log,
    files,
    module: {
      cacheDirectory: "file:///var/cache/",
      FileSystemFile: FakeFile,
      FileSystemDirectory: FakeDirectory,
    },
  };
}

function fakeLegacyFileSystem() {
  const log: string[] = [];
  return {
    log,
    module: {
      cacheDirectory: "file:///var/cache/",
      async makeDirectoryAsync(uri: string, options: unknown) {
        log.push(`mkdir ${uri} ${JSON.stringify(options)}`);
      },
      async writeAsStringAsync(uri: string, contents: string, options: unknown) {
        log.push(`write ${uri} ${contents} ${JSON.stringify(options)}`);
      },
      async deleteAsync(uri: string, options: unknown) {
        log.push(`delete ${uri} ${JSON.stringify(options)}`);
      },
    },
  };
}

function deps(overrides: Partial<NativeSinkDeps> = {}): NativeSinkDeps {
  let next = 0;
  return {
    shareDataUrl: async () => "shared",
    createId: () => {
      next += 1;
      return `id${next}`;
    },
    sharedDirectories: [],
    ...overrides,
  };
}

const FILE = { fileName: "report final.pdf", mimeType: "application/pdf", size: 6 };

describe("resolveNativeSaveMethod", () => {
  it("prefers the current file system module, then the legacy one", () => {
    const sharing = fakeSharing().module;
    const fileSystem = fakeFileSystem().module;
    const legacy = fakeLegacyFileSystem().module;
    expect(
      resolveNativeSaveMethod("android", {
        ExpoSharing: sharing,
        FileSystem: fileSystem,
        ExponentFileSystem: legacy,
      })?.kind,
    ).toBe("expo-file");
    expect(
      resolveNativeSaveMethod("android", { ExpoSharing: sharing, ExponentFileSystem: legacy })
        ?.kind,
    ).toBe("expo-legacy");
  });

  it("skips modules that do not have the expected shape", () => {
    const sharing = fakeSharing().module;
    const legacy = fakeLegacyFileSystem().module;
    const broken = { FileSystemFile: fakeFileSystem().module.FileSystemFile };
    expect(
      resolveNativeSaveMethod("android", {
        ExpoSharing: sharing,
        FileSystem: broken,
        ExponentFileSystem: legacy,
      })?.kind,
    ).toBe("expo-legacy");
    expect(
      resolveNativeSaveMethod("android", {
        ExpoSharing: {},
        FileSystem: fakeFileSystem().module,
      }),
    ).toBeNull();
  });

  it("falls back to a data URL share on iOS only", () => {
    expect(resolveNativeSaveMethod("ios", undefined)).toEqual({ kind: "share-data-url" });
    expect(resolveNativeSaveMethod("ios", { FileSystem: fakeFileSystem().module })).toEqual({
      kind: "share-data-url",
    });
    expect(resolveNativeSaveMethod("android", undefined)).toBeNull();
    expect(resolveNativeSaveMethod("android", { FileSystem: fakeFileSystem().module })).toBeNull();
  });
});

describe("expo-file sink", () => {
  function setup(sinkDeps = deps()) {
    const fileSystem = fakeFileSystem();
    const sharing = fakeSharing();
    const sink = createNativeSink(
      { kind: "expo-file", fileSystem: fileSystem.module, sharing: sharing.module },
      sinkDeps,
    );
    return { fileSystem, sharing, sink, sinkDeps };
  }

  it("streams chunks into a per-save cache file and shares it", async () => {
    const { fileSystem, sharing, sink, sinkDeps } = setup();
    const uri = "file:///var/cache/paseo-file-explorer/id1/report%20final.pdf";

    await sink.begin(FILE);
    await sink.append(encodeBase64(Uint8Array.from([1, 2, 3])));
    await sink.append(encodeBase64(Uint8Array.from([4, 5, 6])));
    const result = await sink.finish();

    expect(result).toEqual({ status: "saved" });
    expect(fileSystem.files.get(uri)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fileSystem.log).toEqual([
      `create ${uri} {"intermediates":true,"overwrite":true}`,
      `close ${uri}`,
    ]);
    expect(sharing.calls).toEqual([
      { uri, options: { mimeType: "application/pdf", dialogTitle: "report final.pdf" } },
    ]);
    expect(sinkDeps.sharedDirectories).toEqual(["file:///var/cache/paseo-file-explorer/id1/"]);
  });

  it("deletes the previous share's folder when the next save starts", async () => {
    const sinkDeps = deps();
    const first = setup(sinkDeps);
    await first.sink.begin(FILE);
    await first.sink.finish();

    const second = createNativeSink(
      { kind: "expo-file", fileSystem: first.fileSystem.module, sharing: first.sharing.module },
      sinkDeps,
    );
    await second.begin(FILE);

    expect(first.fileSystem.log).toContain("delete file:///var/cache/paseo-file-explorer/id1/");
    expect(sinkDeps.sharedDirectories).toEqual([]);
  });

  it("removes the partial file when aborted", async () => {
    const { fileSystem, sink, sharing } = setup();
    await sink.begin(FILE);
    await sink.abort();
    expect(fileSystem.log).toContain("delete file:///var/cache/paseo-file-explorer/id1/");
    expect(sharing.calls).toEqual([]);
  });

  it("keeps the file name a single path segment", async () => {
    const { fileSystem, sink } = setup();
    await sink.begin({ ...FILE, fileName: "../secret#1.txt" });
    expect([...fileSystem.files.keys()]).toEqual([
      "file:///var/cache/paseo-file-explorer/id1/.._secret%231.txt",
    ]);
  });
});

describe("expo-legacy sink", () => {
  it("writes the joined base64 once, then shares", async () => {
    const fileSystem = fakeLegacyFileSystem();
    const sharing = fakeSharing();
    const sink = createNativeSink(
      { kind: "expo-legacy", fileSystem: fileSystem.module, sharing: sharing.module },
      deps(),
    );
    const directory = "file:///var/cache/paseo-file-explorer/id1/";

    await sink.begin(FILE);
    await sink.append("AAEC");
    await sink.append("AwQ=");
    await sink.finish();

    expect(fileSystem.log).toEqual([
      `mkdir ${directory} {"intermediates":true}`,
      `write ${directory}report%20final.pdf AAECAwQ= {"encoding":"base64"}`,
    ]);
    expect(sharing.calls).toHaveLength(1);
  });

  it("refuses to join a padded chunk that is not the last one", async () => {
    const sink = createNativeSink(
      {
        kind: "expo-legacy",
        fileSystem: fakeLegacyFileSystem().module,
        sharing: fakeSharing().module,
      },
      deps(),
    );
    await sink.begin(FILE);
    await sink.append("AA==");
    await expect(sink.append("AAEC")).rejects.toThrow("short chunk");
  });
});

describe("data URL sink", () => {
  async function shareWith(outcome: DataUrlShareOutcome) {
    const calls: { url: string; title: string }[] = [];
    const sink = createNativeSink(
      { kind: "share-data-url" },
      deps({
        shareDataUrl: async (input) => {
          calls.push(input);
          return outcome;
        },
      }),
    );
    await sink.begin({ fileName: "a.png", mimeType: "image/png", size: 3 });
    await sink.append("AAEC");
    return { result: await sink.finish(), calls };
  }

  it("shares a data URL and reports the outcome", async () => {
    const shared = await shareWith("shared");
    expect(shared.result).toEqual({ status: "saved" });
    expect(shared.calls).toEqual([{ url: "data:image/png;base64,AAEC", title: "a.png" }]);

    const dismissed = await shareWith("dismissed");
    expect(dismissed.result).toEqual({ status: "cancelled" });
  });
});
