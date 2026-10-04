import { spawn } from "node:child_process";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/** Variables that would point git at another repository than the worktree root. */
const REPO_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"];

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name of REPO_ENV) delete env[name];
  return env;
}

/**
 * Runs git in `cwd` and resolves with stdout. Exit codes outside `okCodes`
 * reject with the command, directory and stderr.
 */
export function runGit(
  cwd: AbsolutePath,
  args: readonly string[],
  options: { input?: string; okCodes?: readonly number[] } = {},
): Promise<string> {
  const okCodes = options.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: gitEnv(), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => reject(new Error(`git ${args[0]} in ${cwd}: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== null && okCodes.includes(code)) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(err).toString("utf8").trim();
      reject(new Error(`git ${args.join(" ")} in ${cwd} exited with ${code}: ${stderr}`));
    });
    child.stdin.on("error", () => {
      // EPIPE when git exits before reading stdin; the exit code reports the failure.
    });
    child.stdin.end(options.input ?? "");
  });
}

function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

/**
 * Paths among `paths` that git ignores. One `git check-ignore --stdin` call.
 * Tracked files are never reported, even when a pattern matches them.
 *
 * Spec 001 D2: "at batch time, run the paths through one `git check-ignore
 * --stdin`".
 */
export async function checkIgnored(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  if (paths.length === 0) return new Set();
  const input = `${paths.join("\0")}\0`;
  // Exit 1 means no path is ignored.
  const out = await runGit(root, ["check-ignore", "-z", "--stdin"], { input, okCodes: [0, 1] });
  return new Set(splitNul(out));
}

/**
 * Untracked ignored entries, collapsed to directories with a trailing `/`.
 *
 * Spec 001 D2: "the output of `git ls-files --others --ignored
 * --exclude-standard --directory`".
 */
export async function listIgnored(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
  ]);
  return splitNul(out);
}

export interface GitStatus {
  /** Paths git reports as modified, added, deleted or untracked; sorted. */
  readonly paths: readonly RelativePath[];
  /** Untracked directories git stops at because they hold their own `.git`; sorted. */
  readonly nestedRepos: readonly RelativePath[];
}

/**
 * `git status --porcelain` with every untracked file listed. Runs without
 * optional locks so it never takes `index.lock` from under the agent.
 *
 * Spec 001 D2: "A reconciliation pass [...]: `git status --porcelain` plus a
 * re-stat of every file in the hash cache."
 */
export async function gitStatus(root: AbsolutePath): Promise<GitStatus> {
  const out = await runGit(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
    "--ignore-submodules=all",
  ]);
  const paths = new Set<RelativePath>();
  const nestedRepos = new Set<RelativePath>();
  for (const entry of splitNul(out)) {
    // "XY path": two status letters and a space. --no-renames means no second path.
    const path = entry.slice(3);
    // With --untracked-files=all git lists a directory only when it is another repository.
    if (path.endsWith("/")) nestedRepos.add(path.slice(0, -1));
    else paths.add(path);
  }
  return { paths: [...paths].sort(), nestedRepos: [...nestedRepos].sort() };
}

/** Paths of submodules declared in `.gitmodules`, which git status does not list when clean. */
export async function listSubmodules(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(
    root,
    ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    // 1: no match or no such file.
    { okCodes: [0, 1] },
  );
  // -z prints "key\nvalue\0".
  return splitNul(out).flatMap((entry) => {
    const value = entry.slice(entry.indexOf("\n") + 1);
    return value === "" ? [] : [value];
  });
}
