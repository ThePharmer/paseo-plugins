import type { TextStore } from "./local-open-files";

// iOS and Android have no synchronous storage the plugin can import, but the Paseo app ships
// expo-sqlite and registers its native module ("ExpoSQLite") on globalThis.expo.modules. This
// drives that module's synchronous API the way expo-sqlite's own openDatabaseSync() and
// SQLiteStatement.executeSync() do, against a database file only this plugin uses. Call shapes
// were checked against expo-sqlite 16.0.10 (ios/SQLiteModule.swift, android/.../SQLiteModule.kt).
// Everything read from there is untyped, so it is validated before use.
//
// The sync functions run on the JS thread. Each call opens the file, runs one tiny statement and
// closes it again, which keeps the cost to a few milliseconds on an open or a restore.

export const SQLITE_DATABASE_NAME = "paseo-plugin-file-explorer.db";

const CREATE_TABLE =
  "CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);";
const SELECT_VALUE = "SELECT value FROM entries WHERE key = ?;";
const UPSERT_VALUE = "INSERT OR REPLACE INTO entries (key, value) VALUES (?, ?);";

type BindParams = Record<string, string>;

interface NativeDatabase {
  initSync(): void;
  execSync(source: string): void;
  prepareSync(statement: NativeStatement, source: string): void;
  closeSync(): void;
}

interface NativeStatement {
  runSync(
    database: NativeDatabase,
    bindParams: BindParams,
    bindBlobParams: Record<string, never>,
    shouldPassAsArray: boolean,
  ): unknown;
  finalizeSync(database: NativeDatabase): void;
}

interface ExpoSQLiteModule {
  defaultDatabaseDirectory: string;
  ensureDatabasePathExistsSync(databasePath: string): void;
  NativeDatabase: new (databasePath: string, options: Record<string, never>) => unknown;
  NativeStatement: new () => unknown;
}

class UnsupportedSqliteError extends Error {
  constructor() {
    super("This Paseo app's SQLite module is not supported");
    this.name = "UnsupportedSqliteError";
  }
}

/** A TextStore over the plugin's own SQLite file, or null when the module is missing or unknown. */
export function createExpoSqliteTextStore(modules: unknown): TextStore | null {
  const sqlite = readProperty(modules, "ExpoSQLite");
  if (!isSqliteModule(sqlite)) return null;
  return {
    read: (key) =>
      withDatabase(sqlite, (database) => {
        const result = runStatement(sqlite, database, SELECT_VALUE, { "0": key });
        const values = readProperty(result, "firstRowValues");
        if (!Array.isArray(values) || values.length === 0) return null;
        const value: unknown = values[0];
        return typeof value === "string" ? value : null;
      }),
    write: (key, value) =>
      withDatabase(sqlite, (database) => {
        runStatement(sqlite, database, UPSERT_VALUE, { "0": key, "1": value });
      }),
  };
}

export function sqliteDatabasePath(directory: string): string {
  return `${directory.replace(/\/+$/, "")}/${SQLITE_DATABASE_NAME}`;
}

function withDatabase<T>(sqlite: ExpoSQLiteModule, run: (database: NativeDatabase) => T): T {
  const path = sqliteDatabasePath(sqlite.defaultDatabaseDirectory);
  sqlite.ensureDatabasePathExistsSync(path);
  const database = new sqlite.NativeDatabase(path, {});
  if (!isNativeDatabase(database)) {
    closeUnknown(database);
    throw new UnsupportedSqliteError();
  }
  try {
    database.initSync();
    database.execSync(CREATE_TABLE);
    return run(database);
  } finally {
    try {
      database.closeSync();
    } catch {
      // Already closed or never opened; the native side finalizes leftovers on close or GC.
    }
  }
}

function runStatement(
  sqlite: ExpoSQLiteModule,
  database: NativeDatabase,
  source: string,
  params: BindParams,
): unknown {
  const statement = new sqlite.NativeStatement();
  if (!isNativeStatement(statement)) throw new UnsupportedSqliteError();
  database.prepareSync(statement, source);
  try {
    // Positional params as expo-sqlite's normalizeParams() sends them: keys "0", "1", ...
    return statement.runSync(database, params, {}, true);
  } finally {
    statement.finalizeSync(database);
  }
}

function closeUnknown(database: unknown): void {
  const close = readProperty(database, "closeSync");
  if (typeof close !== "function") return;
  try {
    Reflect.apply(close, database, []);
  } catch {
    // Nothing else to release from an object this module does not recognize.
  }
}

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return property;
}

function hasMethods(value: unknown, names: readonly string[]): boolean {
  return names.every((name) => typeof readProperty(value, name) === "function");
}

function isSqliteModule(value: unknown): value is ExpoSQLiteModule {
  const directory = readProperty(value, "defaultDatabaseDirectory");
  return (
    typeof directory === "string" &&
    directory.length > 0 &&
    hasMethods(value, ["ensureDatabasePathExistsSync", "NativeDatabase", "NativeStatement"])
  );
}

function isNativeDatabase(value: unknown): value is NativeDatabase {
  return hasMethods(value, ["initSync", "execSync", "prepareSync", "closeSync"]);
}

function isNativeStatement(value: unknown): value is NativeStatement {
  return hasMethods(value, ["runSync", "finalizeSync"]);
}
