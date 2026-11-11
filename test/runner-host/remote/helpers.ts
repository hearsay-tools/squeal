import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { copyObserveRuntime } from "../../../src/harness/build.js";
import { bundleOptions } from "../../../src/harness/claude-code/build.js";

/*
 * Spec 021 rows 021-13, 021-14: what the remote tests share. A lean bundle
 * as the plugin ships its CLI, a fake `ssh` that runs the remote command
 * in a directory of this machine, and a fixture worktree under Git.
 */

const repoRoot = resolve(import.meta.dirname, "../../..");
const fixturesDir = join(repoRoot, "test/fixtures/vitest");
/** Inside the repository, so a tree there resolves `vitest` from its `node_modules`. Git-ignored. */
export const scratchDir = join(fixturesDir, ".tmp");

/** Builds `cli/squeal.mjs` and the observe runtime into `outdir`; returns the CLI's path. */
export async function buildBundle(outdir: string): Promise<string> {
  await build({
    ...bundleOptions(outdir),
    entryPoints: [{ in: "src/cli/index.ts", out: "cli/squeal" }],
    metafile: false,
  });
  copyObserveRuntime(outdir);
  return join(outdir, "cli/squeal.mjs");
}

/**
 * A fake `ssh` in `dir`: it takes the destination and the command as ssh
 * does, appends the destination to `<home>/.destinations`, and runs the
 * command with `sh -c` in `home`, as a login would in its home.
 */
export function fakeSsh(dir: string, home: string): string {
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const path = join(dir, "ssh");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'while [ $# -gt 0 ]; do case "$1" in -T) shift ;; -o) shift 2 ;; *) break ;; esac; done',
      `echo "$1" >> ${JSON.stringify(join(home, ".destinations"))}`,
      `cd ${JSON.stringify(home)} && exec sh -c "$2"`,
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

/** A copy of the Vitest fixture `name` under scratch, with `files`, in a Git repository of its own. */
export function gitFixture(name: string, files: Readonly<Record<string, string>> = {}): string {
  const root = join(scratchDir, `${name}-remote-${randomUUID()}`);
  mkdirSync(scratchDir, { recursive: true });
  cpSync(join(fixturesDir, name), root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["init", "-q", root]);
  return root;
}
