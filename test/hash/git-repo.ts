import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Environment for test git commands: no user config, no hook-inherited repository. */
const gitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    delete env[name];
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_AUTHOR_NAME = "squeal";
  env.GIT_AUTHOR_EMAIL = "squeal@example.com";
  env.GIT_COMMITTER_NAME = "squeal";
  env.GIT_COMMITTER_EMAIL = "squeal@example.com";
  return env;
};

export function git(cwd: string, args: readonly string[], input?: Buffer | string): string {
  return execFileSync("git", args, { cwd, env: gitEnv(), input, encoding: "utf8" });
}

/** A throwaway directory removed by `cleanup`. */
export function tempDir(prefix = "squeal-test-"): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function writeFile(root: string, path: string, content: Buffer | string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** Creates a repository at `root` with `files` committed. */
export function initRepo(
  root: string,
  files: Readonly<Record<string, Buffer | string>>,
  options: { objectFormat?: "sha1" | "sha256" } = {},
): void {
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", `--object-format=${options.objectFormat ?? "sha1"}`, "-b", "main"]);
  for (const [path, content] of Object.entries(files)) {
    writeFile(root, path, content);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "init"]);
}

/** `git hash-object` of a file, run inside `repo` so its object format applies. */
export function gitHashObject(repo: string, path: string): string {
  return git(repo, ["hash-object", "--no-filters", path]).trim();
}
