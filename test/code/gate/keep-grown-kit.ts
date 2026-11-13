import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { LookupSources } from "../../../src/core/code/gate/keep-expected.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { readHead } from "../../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { createFsHasher, type Hasher } from "../../../src/core/hash/hasher.js";
import { observedModulesMetaKey } from "../../../src/core/keys/modules.js";
import {
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../../../src/core/keys/observed.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import type { ObservedInputs, RunReport } from "../../../src/core/types/runner.js";
import { git, scratchStore, writeTree } from "../../keys/validity/harness/shared.js";
import { POLICY, RECORD, type Served, type ServedOptions, served } from "./keep-daemon-kit.js";

/*
 * Rows 020-39 and 020-48 (spec 020 D17.3): the kit of the tests of a file
 * kept at the key with what its run read. A keeper with a lookup's real
 * keys over a scratch store, as `gate/stored.ts` opens them, and the
 * repository's store, with or without a daemon that serves the worktree.
 */

export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };
export const READ = "data/known.txt";

const FILES: Readonly<Record<string, string>> = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "export const b = 2;\n",
  [READ]: "known\n",
  [A.path]: 'import { a } from "../src/a.ts";\n',
  [B.path]: 'import { b } from "../src/b.ts";\n',
};

/** `a`'s run read `data/known.txt`, a process it started imported it, and it loaded `src/a.ts`. */
export const A_READ: ObservedInputs = {
  testFile: A,
  paths: [READ],
  directories: [],
  direct: [READ],
  modules: ["src/a.ts"],
};

/** The note before row 020-48 on `a`, kept at its grown key with no reads merged. */
export const GROWN_NOT_KEPT = `1 completed test file was not kept in the stores, because it read paths its key lacks (${READ}): test/a.test.ts; the next run will run it again`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface Lookup {
  readonly root: string;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
}

/** `root` as a committed repository, keyed as a daemon's start keys it, over a scratch store. */
async function lookup(root: string): Promise<Lookup> {
  writeTree(root, FILES);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const scratch = mkdtempSync(join(tmpdir(), "squeal-keep-grown-keys-"));
  dirs.push(scratch);
  const store = scratchStore(scratch);
  const hasher = createFsHasher(root, "sha1");
  const keys = new WorktreeKeys({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    hasher,
    objectFormat: "sha1",
    policy: loadPolicy(root).policy,
    squealVersion: "0.0.0-keep-grown",
    env: {},
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  await keys.setEnvironments([
    {
      project: "",
      runnerName: "vitest",
      runnerVersion: "0.0.0",
      adapterVersion: "0",
      resolvedConfig: "{}",
      files: [],
    },
  ]);
  keys.setClosure({ testFile: A, paths: ["src/a.ts"] });
  keys.setClosure({ testFile: B, paths: ["src/b.ts"] });
  await keys.trackUntracked();
  return { root, keys, hasher };
}

export type Worktree = Lookup & { readonly commonDir: string };

/** A worktree with no daemon: its repository and its store's directory. */
export async function worktree(): Promise<Worktree> {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-grown-"));
  dirs.push(root);
  return { ...(await lookup(root)), commonDir: join(root, ".git") };
}

/** A worktree whose daemon serves it (`served`), with the daemon's kit (row 020-48). */
export async function servedWorktree(
  options: ServedOptions = {},
): Promise<Worktree & { readonly served: Served }> {
  const daemon = await served(options);
  return { ...(await lookup(daemon.root)), commonDir: daemon.commonDir, served: daemon };
}

export function keyOf(keys: WorktreeKeys, ref: TestFileRef): CheckKey {
  const key = keys.index.key(ref);
  if (key === null) throw new Error(`${ref.path} has no key`);
  return key;
}

export interface KeepOptions {
  readonly files?: readonly TestFileRef[];
  /** After the lookup's expectation, before the run's decision: during the run. */
  readonly started?: () => void;
  /** After the run's decision, before `flush`. */
  readonly between?: () => void;
  readonly busyBoundMs?: number;
  /** What `a`'s run read; default `A_READ`. */
  readonly observed?: ObservedInputs;
  readonly sources?: LookupSources;
}

/**
 * A keeper of `at` expects `files` at their keys, their run completes them
 * with `a`'s reads, `between` runs after the run's decision, then `flush`.
 * Returns the key `a` ran under.
 */
export async function keep(at: Worktree, notes: string[], options: KeepOptions = {}) {
  const { files = [A], between, busyBoundMs, observed = A_READ } = options;
  const keeper = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: POLICY,
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
    ...(busyBoundMs === undefined ? {} : { busyBoundMs }),
  });
  const ran = keyOf(at.keys, A);
  const keyed = new Map(files.map((f) => [f, keyOf(at.keys, f)]));
  keeper.expect("vitest", at.keys, at.hasher, keyed, options.sources);
  options.started?.();
  const report: RunReport = {
    end: "completed",
    durationMs: 1,
    completedFiles: [...files],
    results: [],
    fileErrors: [],
    failure: null,
    observed: [observed],
  };
  const records = new Map(files.map((f) => [testFileId(f), { record: RECORD }]));
  await keeper.ran({ runner: "vitest", files: [...files], report, records });
  between?.();
  await keeper.flush();
  return ran;
}

/** The results stored at `key`. */
export function resultsAt(commonDir: string, key: CheckKey): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key);
    return Number(row?.n);
  } finally {
    db.close();
  }
}

/** `a`'s entry in each shared row: observed, direct, modules. */
export function rowsOf(commonDir: string): (readonly string[] | undefined)[] {
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    const keys = [observedMetaKey(""), observedDirectMetaKey(""), observedModulesMetaKey("")];
    return keys.map((key) => readSharedEntries(store, key)[A.path]);
  } finally {
    store.close();
  }
}
