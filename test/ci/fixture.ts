import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ciCommand } from "../../src/cli/ci.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { onCleanUp } from "../scheduler/cleanup.js";

/*
 * Spec 018 D8 and D9: repositories for `squeal ci record` and `squeal ci
 * export` with the project's own Vitest. They live under the fixtures'
 * scratch inside the repository, so their Vitest resolves from the
 * repository's `node_modules`.
 */

const REPO = resolve(import.meta.dirname, "../..");
export const VITEST = join(REPO, "node_modules/vitest/vitest.mjs");
const SCRATCH = join(REPO, "test/fixtures/vitest/.tmp");

/** A new directory under the fixtures' scratch; the caller removes it. */
export function scratchDir(name: string): string {
  const dir = join(SCRATCH, `${name}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A directory under the fixtures' scratch, removed after the test. */
export function scratch(name: string): string {
  const dir = scratchDir(name);
  onCleanUp(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes `files` below `root`. */
export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** `<dir>/origin`: a repository whose one commit holds `files`, and what `prepare` wrote there. */
export function committed(
  dir: string,
  files: Readonly<Record<string, string>>,
  prepare: (root: string) => void = () => {},
): string {
  const root = join(dir, "origin");
  writeFiles(root, files);
  prepare(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  return root;
}

/** A fresh clone of `origin` beside it, as a CI job's checkout of the same commit. */
export function cloneOf(origin: string, name: string): AbsolutePath {
  const root = join(dirname(origin), name);
  execFileSync("git", ["clone", "-q", origin, root]);
  return root;
}

/** `squeal ci <args>` in `cwd`: its exit code and all it said. */
export async function ci(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; said: string }> {
  let said = "";
  const add = (text: string) => {
    said += text;
  };
  const code = await ciCommand(args, { stdout: add, stderr: add, cwd, env });
  return { code, said };
}

/** `squeal ci record --out <out> -- vitest run <args>` in `root`, with `CI=true` as in CI. */
export function recordVitest(
  root: string,
  out: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; said: string }> {
  const command = [process.execPath, VITEST, "run", ...args];
  return ci(["record", "--out", out, "--", ...command], root, {
    ...process.env,
    CI: "true",
    ...env,
  });
}
