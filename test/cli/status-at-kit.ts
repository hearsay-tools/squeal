import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { type AtArgs, type AtOptions, statusAtCommand } from "../../src/cli/status-at.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { Store } from "../../src/core/types/store.js";
import { type Fixture, git, linkInstall } from "../commit/at-keys-fixture.js";

/*
 * Row 023-06: what the `status --at` fixture tests share: a test file's
 * text, check ids, a store write, one command run with its output, and the
 * check that no checkout or worktree is left.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** Row 023-07: this repository's CLI from source through tsx, so `--run`'s child is a real one. */
export const RELAUNCH: readonly string[] = [
  process.execPath,
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
