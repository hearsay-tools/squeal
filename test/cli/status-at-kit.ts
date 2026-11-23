import { mkdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { type AtArgs, type AtOptions, statusAtCommand } from "../../src/cli/status-at.js";
import type { AtDaemons, NarrowCall } from "../../src/cli/status-at-daemons.js";
import { changeOf } from "../../src/core/daemon/at-asks.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import {
  type AbsolutePath,
  PAYLOAD_SCHEMA_VERSION,
  type RelativePath,
} from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { type Fixture, git, linkInstall } from "../commit/at-keys-fixture.js";
import { VERSION_ARGS } from "../fixed-version.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Row 023-06: what the `status --at` fixture tests share: a test file's
 * text, check ids, a store write, one command run with its output, and the
 * check that no checkout or worktree is left.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/**
 * Row 023-07: this repository's CLI from source through tsx, so `squeal proof`'s child is a real one;
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

/**
 * Row 023-40: no daemon in a fixture test unless the test gives its own:
 * `--run` and `--wait` then reach none, and say so.
 */
export const NO_DAEMONS: AtDaemons = {
  commit: async () => ({ problem: "no daemon in this test" }),
  commitAsk: async () => "no daemon in this test",
  commitRead: async () => "no daemon in this test",
  find: () => null,
  worktree: async () => "no daemon in this test",
  now: async () => ({ kind: "unserved", problem: "no daemon in this test" }),
  ask: async () => ({ problem: "no daemon in this test" }),
  wait: async () => null,
};

export async function run(
  f: Fixture,
  args: Partial<AtArgs> & Pick<AtArgs, "commit">,
  options: AtOptions = { cacheRoot: f.cacheRoot, install: linkInstall().install },
  now?: number,
  env?: NodeJS.ProcessEnv,
) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: f.root,
    relaunch: RELAUNCH,
    ...(now === undefined ? {} : { now: () => now }),
    ...(env === undefined ? {} : { env }),
  };
  const code = await statusAtCommand({ paths: [], json: false, ...args }, io, {
    daemons: NO_DAEMONS,
    ...options,
  });
  return { code, out: out.join(""), err: err.join("") };
}

/** No checkout and no extra worktree is left. */
export function clean(f: Fixture): void {
  expect(f.checkouts()).toEqual([]);
  expect(git(f.root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
}

/*
 * Row 023-40: stand-in daemons for `--run` and `--wait` on a fixture.
 */

export interface Ask {
  readonly root: string;
  readonly group: string;
  readonly paths: readonly RelativePath[];
  readonly call: NarrowCall;
}

/** What a stand-in commit daemon does with an ask (row 023-40c). */
export interface StandInCommit {
  /** The files it selects and queues; by default the named paths, as files of the default project. */
  readonly select?: (ask: Omit<CommitAskRequest, "type">) => readonly TestFileRef[];
  /** Writes its rows for the files it queued (as the daemon's listing and queue would). */
  readonly rows?: (tree: AbsolutePath, files: readonly TestFileRef[]) => void;
  /** Row 023-53 (V8): the change's whole selection it tells in each ask (`selects`); absent: none. */
  readonly selects?: number;
  /** Row 023-58 (W1): the files it would run that have a result at the commit (`withResult`). */
  readonly withResult?: (ask: Omit<CommitAskRequest, "type">) => readonly TestFileRef[];
}

/** Stand-in daemons: each records what it is asked; `onWait` plays what the daemon did meanwhile. */
export function standIn(
  tree: AbsolutePath,
  onWait: (root: string, files: readonly TestFileRef[]) => void,
  commitDaemon: StandInCommit = {},
) {
  const asks: Ask[] = [];
  const commits: string[] = [];
  const started: string[] = [];
  const waits: string[] = [];
  const commitAsks: Omit<CommitAskRequest, "type">[] = [];
  const queued = new Map<string, readonly TestFileRef[]>();
  // Review 0.1.599 B4: each ask's change identity, as the daemon keeps it.
  const changes = new Map<string, string>();
  const withResult = new Map<string, readonly TestFileRef[]>();
  const ports: AtDaemons = {
    async commit(input) {
      commits.push(input.commit);
      return tree;
    },
    async commitAsk(_tree, ask) {
      commitAsks.push(ask);
      const files =
        commitDaemon.select?.(ask) ?? ask.named.map((path): TestFileRef => ({ project: "", path }));
      queued.set(ask.owner, files);
      changes.set(ask.owner, changeOf(ask.changed));
      const kept = commitDaemon.withResult?.(ask);
      if (kept !== undefined) withResult.set(ask.owner, kept);
      commitDaemon.rows?.(tree, files);
      return null;
    },
    async commitRead(_tree, owners) {
      const asks = [...queued]
        .filter(([owner]) => owners === undefined || owners.includes(owner))
        .map(([owner, files]) => ({
          owner,
          change: changes.get(owner) ?? "",
          phase: "queued" as const,
          files,
          readers: {},
          problems: [],
          ...(commitDaemon.selects === undefined ? {} : { selects: commitDaemon.selects }),
          ...(withResult.has(owner) ? { withResult: withResult.get(owner) ?? [] } : {}),
        }));
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        ok: true,
        type: "commit-read",
        setup: { phase: "ready" },
        asks,
      };
    },
    find: () => tree,
    // Review wave-23-third B1: the working tree's side is the daemon's answer, keyed by the stand-in.
    now: keyedNow,
    async worktree(root) {
      started.push(root);
      return null;
    },
    async ask(root, group, paths, _deadline, call) {
      asks.push({ root, group, paths, call });
      return "taken";
    },
    async wait(root, files) {
      waits.push(root);
      onWait(root, files);
      return null;
    },
  };
  return { ports, asks, commits, started, waits, commitAsks };
}

/** A folder that stands for the commit worktree's tree. */
export function standInTree(f: Fixture): AbsolutePath {
  const tree = join(f.dir, "commit-tree");
  mkdirSync(tree, { recursive: true });
  return realpathSync(tree) as AbsolutePath;
}
