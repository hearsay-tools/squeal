import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { type AtArgs, type AtOptions, statusAtCommand } from "../../src/cli/status-at.js";
import { commitRun } from "../../src/cli/status-at-commit-run.js";
import type { RunArgs } from "../../src/cli/status-at-run.js";
import { resolveCommit } from "../../src/core/commit/at-keys-checkout.js";
import { resolveCommonDir, worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { type Fixture, git, linkInstall } from "../commit/at-keys-fixture.js";
import { VERSION_ARGS } from "../fixed-version.js";

/*
 * Row 023-06: what the `status --at` fixture tests share: a test file's
 * text, check ids, a store write, one command run with its output, and the
 * check that no checkout or worktree is left.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/**
 * Row 023-07: this repository's CLI from source through tsx, so `--run`'s child is a real one;
 * row 011-425: at the worker's version, so it reads no `package.json` for one.
 */
export const RELAUNCH: readonly string[] = [
  process.execPath,
  ...VERSION_ARGS,
  "--import",
  TSX,
  resolve(import.meta.dirname, "../../src/cli/index.ts"),
];

/** A test that imports `../src/<module>` and checks its `value`. */
export const testOf = (module: string, value: number) =>
  [
    'import { expect, it } from "vitest";',
    `import { value } from "../src/${module}";`,
    `it("value", () => expect(value).toBe(${value}));`,
    "",
  ].join("\n");

export const check = (path: string) => ({ kind: "file", project: "", testPath: path }) as const;
export const testCheck = (path: string) =>
  ({ kind: "test", project: "", testPath: path, fullName: "value" }) as const;

export function withStore(f: Fixture, body: (store: Store) => void): void {
  const store = openStore(join(f.root, ".git"));
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    body(store);
  } finally {
    store.close();
  }
}

export async function run(
  f: Fixture,
  args: Partial<AtArgs> & Pick<AtArgs, "commit">,
  options: AtOptions = { cacheRoot: f.cacheRoot, install: linkInstall().install },
  now?: number,
) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: f.root,
    relaunch: RELAUNCH,
    ...(now === undefined ? {} : { now: () => now }),
  };
  const code = await statusAtCommand({ paths: [], json: false, ...args }, io, options);
  return { code, out: out.join(""), err: err.join("") };
}

/** No checkout and no extra worktree is left. */
export function clean(f: Fixture): void {
  expect(f.checkouts()).toEqual([]);
  expect(git(f.root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
}

/**
 * Row 023-29 (review wave-18 note 3): the commit side's run alone, at the
 * commit-run boundary (`commitRun` with no working tree's turn), for tests
 * of that run: its batches, stops, stores and records. `out` is JSON with
 * the fields of the command's report those tests read: each file's commit
 * side, `run` and `failure`. `root`: the worktree it runs from.
 */
export async function runCommit(
  f: Fixture,
  args: { readonly commit: string; readonly paths?: readonly string[]; readonly run: RunArgs },
  options: AtOptions = { cacheRoot: f.cacheRoot, install: linkInstall().install },
  root: string = f.root,
): Promise<{ readonly out: string; readonly err: string }> {
  const tree = realpathSync(root) as AbsolutePath;
  const commonDir = resolveCommonDir(tree);
  if (commonDir === null) throw new Error(`${tree} is not in a git worktree`);
  const err: string[] = [];
  const paths = args.paths ?? [];
  const side = await commitRun({
    root: tree,
    commonDir,
    worktreeId: worktreeIdFor(tree),
    commit: await resolveCommit(tree, args.commit),
    given: args.commit,
    givenPaths: paths,
    paths: paths.length === 0 ? null : paths,
    run: args.run,
    env: { ...process.env },
    relaunch: RELAUNCH,
    note: (text) => err.push(`squeal: ${text}\n`),
    forward: (text) => err.push(text),
    options,
  });
  const files = side.at.refs.map((ref) => ({ ...ref, at: side.state(ref) }));
  const out = JSON.stringify({ files, run: side.ran?.use() ?? null, failure: side.at.failure });
  return { out, err: err.join("") };
}
