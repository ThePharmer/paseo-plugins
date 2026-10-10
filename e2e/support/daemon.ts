import { execFile, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// The user's own daemon lives on this port and in ~/.paseo. Nothing here may touch either.
const RESERVED_PORT = 6767;
const READY_TIMEOUT_MS = 90_000;

export interface IsolatedDaemon {
  /** Version of the @getpaseo/cli package that launched the daemon. */
  cliVersion: string;
  /** Version the daemon reports in /api/status. */
  daemonVersion: string;
  home: string;
  port: number;
  origin: string;
  serverId: string;
  logPath: string;
  /** Runs the installed `paseo` CLI against this daemon's home. Adds `--home` for you. */
  paseo(args: string[]): Promise<string>;
  /** Stops the daemon, copies its log into `artifactsDir`, and removes the home. Idempotent. */
  stop(): Promise<void>;
}

export interface StartDaemonOptions {
  /** Directory that receives daemon.log when the daemon stops. */
  artifactsDir: string;
  /** Keep the temporary home after stopping (for debugging). */
  keepHome?: boolean;
}

function cliPackageDir(): string {
  return path.dirname(require.resolve("@getpaseo/cli/package.json"));
}

export async function installedCliVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(path.join(cliPackageDir(), "package.json"), "utf8"));
  return pkg.version as string;
}

/**
 * Environment for every daemon and CLI process: the caller's environment minus anything that
 * could point at, or authenticate against, another Paseo daemon. HOME moves into the temporary
 * home so `~` paths, git config and agent provider state stay isolated too.
 */
function isolatedEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("PASEO_") || key === "PORT") continue;
    env[key] = value;
  }
  return { ...env, HOME: home, USERPROFILE: home, CI: "true", NO_COLOR: "1" };
}

async function probeFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (typeof address !== "object" || !address) throw new Error("Could not read the probe port");
  return address.port;
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await probeFreePort();
    if (port !== RESERVED_PORT) return port;
  }
  throw new Error("Could not allocate a free port");
}

async function waitFor<T>(
  description: string,
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const reason = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}${reason}`);
}

function assertIsolated(home: string, port: number): void {
  const userHome = path.resolve(homedir(), ".paseo");
  if (port === RESERVED_PORT) throw new Error(`Refusing to use port ${RESERVED_PORT}`);
  if (path.resolve(home) === userHome || path.resolve(home).startsWith(`${userHome}${path.sep}`)) {
    throw new Error(`Refusing to use ${home} as a test home`);
  }
}

export async function startIsolatedDaemon(options: StartDaemonOptions): Promise<IsolatedDaemon> {
  const cliVersion = await installedCliVersion();
  const home = await mkdtemp(path.join(tmpdir(), "paseo-plugins-e2e-"));
  const port = await freePort();
  assertIsolated(home, port);
  const origin = `http://127.0.0.1:${port}`;
  const logPath = path.join(home, "daemon.log");
  const env = isolatedEnv(home);
  const bin = path.join(cliPackageDir(), "bin", "paseo");

  const paseo = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [bin, ...args, "--home", home], {
        env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
      });
      return stdout;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `paseo ${args.join(" ")} failed: ${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
        { cause: error },
      );
    }
  };

  // Persistent config, the same way upstream's packaged-web-daemon e2e helper starts one. `paseo
  // daemon start` ignores PASEO_* deployment overrides, so everything lives in config.json.
  await writeFile(
    path.join(home, "config.json"),
    `${JSON.stringify(
      {
        pluginsEnabled: true,
        daemon: {
          listen: `127.0.0.1:${port}`,
          relay: { enabled: false },
          mcp: { enabled: false },
        },
        features: {
          webUi: { enabled: true },
          dictation: { enabled: false },
          voiceMode: { enabled: false },
        },
      },
      null,
      2,
    )}\n`,
  );

  let stopped = false;
  let pids: number[] = [];
  const killFallback = () => {
    // Last resort when the runner exits without running teardown. Synchronous by necessity.
    if (stopped) return;
    spawnSync(process.execPath, [bin, "daemon", "stop", "--home", home, "--force"], {
      env,
      timeout: 20_000,
    });
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  };
  process.once("exit", killFallback);

  const stop = async () => {
    if (stopped) return;
    try {
      await paseo(["daemon", "stop", "--force", "--timeout", "15"]).catch((error) => {
        console.warn(`[e2e] daemon stop reported: ${(error as Error).message.split("\n")[0]}`);
      });
      for (const pid of pids) {
        try {
          process.kill(pid, 0);
          process.kill(pid, "SIGKILL");
        } catch {
          // exited
        }
      }
      await mkdir(options.artifactsDir, { recursive: true });
      await copyFile(logPath, path.join(options.artifactsDir, `daemon-${cliVersion}.log`)).catch(
        () => undefined,
      );
      if (!options.keepHome) await rm(home, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      stopped = true;
      process.removeListener("exit", killFallback);
    }
  };

  try {
    await paseo(["daemon", "start", "--timeout", String(READY_TIMEOUT_MS / 1000)]);
    const status = JSON.parse(await paseo(["daemon", "status", "--json"])) as {
      pid?: number;
      workerPid?: number;
      listen?: string;
    };
    pids = [status.pid, status.workerPid].filter((pid): pid is number => typeof pid === "number");
    if (status.listen !== `127.0.0.1:${port}`) {
      throw new Error(`Daemon listens on ${status.listen}, expected 127.0.0.1:${port}`);
    }
    const info = await waitFor(
      "daemon /api/status",
      async () => {
        const response = await fetch(`${origin}/api/status`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return undefined;
        return (await response.json()) as { serverId: string; version: string };
      },
      READY_TIMEOUT_MS,
    );
    await waitFor(
      "daemon web UI",
      async () => {
        const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) });
        return response.ok && (await response.text()).includes("<html") ? true : undefined;
      },
      READY_TIMEOUT_MS,
    );
    return {
      cliVersion,
      daemonVersion: info.version,
      home,
      port,
      origin,
      serverId: info.serverId,
      logPath,
      paseo,
      stop,
    };
  } catch (error) {
    const log = await readFile(logPath, "utf8").catch(() => "");
    await stop();
    throw new Error(
      `${(error as Error).message}\n--- daemon.log (tail) ---\n${log.split("\n").slice(-60).join("\n")}`,
      { cause: error },
    );
  }
}

export interface InstalledPlugin {
  id: string;
  status: string;
}

/** Installs a plugin from a local directory and waits until the daemon reports it running. */
export async function installPlugin(
  daemon: IsolatedDaemon,
  directory: string,
): Promise<InstalledPlugin> {
  const installed = JSON.parse(
    await daemon.paseo(["plugin", "install", directory, "--json"]),
  ) as InstalledPlugin;
  return waitFor(
    `plugin ${installed.id} to run`,
    async () => {
      const list = JSON.parse(await daemon.paseo(["plugin", "ls", "--json"])) as InstalledPlugin[];
      const entry = list.find((plugin) => plugin.id === installed.id);
      if (entry?.status === "failed" || entry?.status === "error") {
        throw new Error(`plugin ${installed.id} is ${entry.status}`);
      }
      return entry?.status === "running" ? entry : undefined;
    },
    60_000,
  );
}

export interface FixtureWorkspace {
  projectId: string;
  workspaceId: string;
  title: string;
}

/** Registers a plain directory as a project with one local workspace. */
export async function createWorkspace(
  daemon: IsolatedDaemon,
  directory: string,
  title: string,
): Promise<FixtureWorkspace> {
  const project = JSON.parse(await daemon.paseo(["project", "create", directory, "--json"])) as {
    projectId: string;
  };
  const workspace = JSON.parse(
    await daemon.paseo([
      "workspace",
      "create",
      "--path",
      directory,
      "--isolation",
      "local",
      "--title",
      title,
      "--json",
    ]),
  ) as { workspaceId: string };
  return { projectId: project.projectId, workspaceId: workspace.workspaceId, title };
}
