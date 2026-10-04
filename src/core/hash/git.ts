import { spawn } from "node:child_process";
import type { AbsolutePath } from "../types/index.js";

/**
 * Variables that would point git at another repository than `root`. A hook
 * running inside a git hook inherits them.
 */
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

/**
 * Runs git in `root` and returns stdout. Never takes optional locks, so a
 * status read does not rewrite the worktree's index.
 */
export function runGit(
  root: AbsolutePath,
  args: readonly string[],
  input?: string,
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name of REPOSITORY_VARIABLES) delete env[name];

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`squeal: git ${args.join(" ")} failed in ${root}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`squeal: git ${args.join(" ")} exited ${code} in ${root}: ${message}`));
    });
    // A child that exits before reading stdin closes the pipe; its exit code is the error to report.
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

/** Splits NUL-separated git output, dropping the trailing empty field. */
export function splitNul(output: string): string[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}
