import { spawn } from "node:child_process";
import type { AbsolutePath } from "../types/index.js";

/**
 * Variables that would point git at another repository than `cwd`. A hook
 * running inside a git hook inherits them.
 */
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

export interface RunGitOptions {
  /** Written to stdin; empty when absent. */
  readonly input?: string;
  /** Exit codes that resolve with stdout. Default `[0]`. */
  readonly okCodes?: readonly number[];
}

/**
 * Runs git in `cwd` and resolves with stdout. Exit codes outside `okCodes`
 * reject with the command, directory and stderr. Never takes optional locks,
 * so a status read does not rewrite the worktree's index.
 */
export function runGit(
  cwd: AbsolutePath,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<string> {
  const okCodes = options.okCodes ?? [0];
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name of REPOSITORY_VARIABLES) delete env[name];

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`squeal: git ${args.join(" ")} failed in ${cwd}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== null && okCodes.includes(code)) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`squeal: git ${args.join(" ")} exited ${code} in ${cwd}: ${message}`));
    });
    // A child that exits before reading stdin closes the pipe; its exit code is the error to report.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

/**
 * Splits NUL-separated git output, dropping only the empty field after the
 * final NUL. Empty fields in the middle are kept: `check-attr -z` prints
 * `path NUL attribute NUL value NUL` triples, and a value can be empty, so
 * dropping it would shift every later triple. Every other caller's records are
 * non-empty, so for them the two rules agree.
 */
export function splitNul(output: string): string[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}
