import { describe, expect, it } from "vitest";
import { createLocalOpenFiles } from "./local-open-files";
import {
  createExpoSqliteTextStore,
  SQLITE_DATABASE_NAME,
  sqliteDatabasePath,
} from "./sqlite-text-store";

interface FakeOptions {
  failOn?: "ensure" | "open" | "init" | "exec" | "prepare" | "run" | "finalize" | "close";
  /** Replaces runSync's answer, to stand in for a garbled native result. */
  runResult?: () => unknown;
}

/**
 * Mirrors the ExpoSQLite native module's synchronous surface (expo-sqlite 16.0.10): one table of
 * rows per database path, with the call order and argument shapes recorded.
 */
function fakeExpoSqlite(options: FakeOptions = {}) {
  const log: string[] = [];
  const databases = new Map<string, Map<string, string>>();
  let openCount = 0;
  let unfinalized = 0;

  function fail(step: NonNullable<FakeOptions["failOn"]>) {
    if (options.failOn === step) throw new Error(`native ${step} failed`);
  }

  class NativeStatement {
    source = "";
    runSync(
      database: NativeDatabase,
      bindParams: Record<string, string>,
      bindBlobParams: Record<string, unknown>,
      shouldPassAsArray: boolean,
    ) {
      fail("run");
      const params = JSON.stringify(bindParams);
      log.push(`run ${params} ${JSON.stringify(bindBlobParams)} ${shouldPassAsArray}`);
      const rows = database.rows;
      if (options.runResult) return options.runResult();
      if (this.source.startsWith("SELECT")) {
        const value = rows.get(bindParams["0"]);
        const firstRowValues = value === undefined ? [] : [value];
        return { lastInsertRowId: 0, changes: 0, firstRowValues };
      }
      rows.set(bindParams["0"], bindParams["1"]);
      return { lastInsertRowId: rows.size, changes: 1, firstRowValues: [] };
    }
    finalizeSync(_database: NativeDatabase) {
      unfinalized -= 1;
      fail("finalize");
    }
  }

  class NativeDatabase {
    rows: Map<string, string>;
    constructor(
      readonly path: string,
      readonly openOptions: unknown,
    ) {
      fail("open");
      log.push(`open ${path} ${JSON.stringify(openOptions)}`);
      openCount += 1;
      this.rows = databases.get(path) ?? new Map();
      databases.set(path, this.rows);
    }
    initSync() {
      fail("init");
    }
    execSync(source: string) {
      fail("exec");
      log.push(`exec ${source}`);
    }
    prepareSync(statement: NativeStatement, source: string) {
      fail("prepare");
      statement.source = source;
      unfinalized += 1;
      log.push(`prepare ${source}`);
    }
    closeSync() {
      openCount -= 1;
      log.push("close");
      fail("close");
    }
  }

  return {
    log,
    databases,
    get openCount() {
      return openCount;
    },
    get unfinalized() {
      return unfinalized;
    },
    modules: {
      ExpoSQLite: {
        defaultDatabaseDirectory: "/data/app/files/SQLite/",
        ensureDatabasePathExistsSync(path: string) {
          fail("ensure");
          log.push(`ensure ${path}`);
        },
        NativeDatabase,
        NativeStatement,
      },
    },
  };
}

const PATH = `/data/app/files/SQLite/${SQLITE_DATABASE_NAME}`;

describe("createExpoSqliteTextStore", () => {
  it("writes and reads one row in the plugin's own database, closing it after each call", () => {
    const sqlite = fakeExpoSqlite();
    const store = createExpoSqliteTextStore(sqlite.modules);

    expect(store?.read("k")).toBeNull();
    store?.write("k", "v1");
    store?.write("k", "v2");

    expect(store?.read("k")).toBe("v2");
    expect([...sqlite.databases.keys()]).toEqual([PATH]);
    expect(sqlite.openCount).toBe(0);
    expect(sqlite.unfinalized).toBe(0);
    expect(sqlite.log.slice(0, 6)).toEqual([
      `ensure ${PATH}`,
      `open ${PATH} {}`,
      "exec CREATE TABLE IF NOT EXISTS entries " +
        "(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
      "prepare SELECT value FROM entries WHERE key = ?;",
      'run {"0":"k"} {} true',
      "close",
    ]);
    expect(sqlite.log).toContain('run {"0":"k","1":"v1"} {} true');
  });

  it("builds the path from the module's directory", () => {
    expect(sqliteDatabasePath("/a/SQLite")).toBe(`/a/SQLite/${SQLITE_DATABASE_NAME}`);
    expect(sqliteDatabasePath("/a/SQLite//")).toBe(`/a/SQLite/${SQLITE_DATABASE_NAME}`);
  });

  it("is unavailable when the module is missing or has another shape", () => {
    expect(createExpoSqliteTextStore(undefined)).toBeNull();
    expect(createExpoSqliteTextStore({})).toBeNull();
    expect(createExpoSqliteTextStore({ ExpoSQLite: null })).toBeNull();
    const { ExpoSQLite } = fakeExpoSqlite().modules;
    for (const broken of [
      { ...ExpoSQLite, defaultDatabaseDirectory: null },
      { ...ExpoSQLite, defaultDatabaseDirectory: "" },
      { ...ExpoSQLite, NativeDatabase: undefined },
      { ...ExpoSQLite, NativeStatement: undefined },
      { ...ExpoSQLite, ensureDatabasePathExistsSync: "no" },
    ]) {
      expect(createExpoSqliteTextStore({ ExpoSQLite: broken })).toBeNull();
    }
  });

  it("refuses database and statement objects without the expected methods", () => {
    const { modules } = fakeExpoSqlite();
    let closed = 0;
    class BareDatabase {
      closeSync() {
        closed += 1;
      }
    }
    const bareDatabase = createExpoSqliteTextStore({
      ExpoSQLite: { ...modules.ExpoSQLite, NativeDatabase: BareDatabase },
    });
    expect(() => bareDatabase?.read("k")).toThrow("not supported");
    expect(closed).toBe(1);

    // A statement that carries its source but none of the native methods.
    class BareStatement {
      source = "";
    }
    const bareStatement = createExpoSqliteTextStore({
      ExpoSQLite: { ...modules.ExpoSQLite, NativeStatement: BareStatement },
    });
    expect(() => bareStatement?.read("k")).toThrow("not supported");
  });

  it("reads null from a garbled result", () => {
    for (const result of [null, {}, { firstRowValues: "x" }, { firstRowValues: [42] }]) {
      const sqlite = fakeExpoSqlite({ runResult: () => result });
      expect(createExpoSqliteTextStore(sqlite.modules)?.read("k")).toBeNull();
    }
  });

  it("closes the database when any step after opening throws", () => {
    for (const failOn of ["init", "exec", "prepare", "run", "finalize"] as const) {
      const sqlite = fakeExpoSqlite({ failOn });
      const store = createExpoSqliteTextStore(sqlite.modules);
      expect(() => store?.write("k", "v")).toThrow(`native ${failOn} failed`);
      expect(sqlite.openCount).toBe(0);
    }
  });

  it("does not let a failing close hide the result", () => {
    const sqlite = fakeExpoSqlite({ failOn: "close" });
    const store = createExpoSqliteTextStore(sqlite.modules);
    store?.write("k", "v");
    expect(store?.read("k")).toBe("v");
  });

  it("degrades to an unavailable local list through createLocalOpenFiles", () => {
    for (const failOn of ["ensure", "open", "run"] as const) {
      const store = createExpoSqliteTextStore(fakeExpoSqlite({ failOn }).modules);
      const local = createLocalOpenFiles(store);
      expect(local.readSync()).toBeNull();
      expect(() => local.write([{ root: "/r", path: "a", openedAt: "t" }])).not.toThrow();
    }
  });

  it("round-trips the open-file list", () => {
    const sqlite = fakeExpoSqlite();
    const local = createLocalOpenFiles(createExpoSqliteTextStore(sqlite.modules));
    const files = [{ root: "/r", path: "a", openedAt: "2026-10-01T00:00:00.000Z" }];

    local.write(files);

    expect(local.readSync()).toEqual(files);
  });
});
