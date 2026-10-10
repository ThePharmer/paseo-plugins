import { execFile } from "node:child_process";

// Stands in for Paseo's runGitCommand (packages/server/src/utils/run-git-command.ts), which
// carries daemon-wide process policy and metrics. The explorer only needs exit codes and stdout.

export interface GitCommandOptions {
  cwd: string;
  acceptExitCodes?: number[];
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (exit ${exitCode ?? "none"}): ${stderr.trim()}`);
    this.name = "GitCommandError";
  }
}

export function runGitCommand(
  args: string[],
  { cwd, acceptExitCodes = [0] }: GitCommandOptions,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        const exitCode = error ? (error.code as number) : 0;
        if (!acceptExitCodes.includes(exitCode)) {
          reject(new GitCommandError(args, exitCode, stderr));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}
