import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
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
import { POLICY, RECORD, served } from "./keep-daemon-kit.js";

/*
 * Row 020-39 (spec 020 D17.3, D17.5): the keeper with a lookup's real keys
 * over a scratch store, as `gate/stored.ts` opens them, and the
 * repository's store. Where no daemon serves, a file whose run read a
 * path beyond its key is kept at the key with it, and its read and its
 * marks join the shared rows; a busy store, or a read that moved before
 * the write, keeps nothing at that key. Where a daemon serves, nothing
 * changes: the file is told as not kept, and nothing is merged.
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const READ = "data/known.txt";

const FILES: Readonly<Record<string, string>> = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "export const b = 2;\n",
  [READ]: "known\n",
  [A.path]: 'import { a } from "../src/a.ts";\n',
  [B.path]: 'import { b } from "../src/b.ts";\n',
};

/** `a`'s run read `data/known.txt`, a process it started imported it, and it loaded `src/a.ts`. */
const A_READ: ObservedInputs = {
  testFile: A,
  paths: [READ],
  directories: [],
  direct: [READ],
  modules: ["src/a.ts"],
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Lookup {
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

/** A worktree with no daemon: its repository and its store's directory. */
async function worktree(): Promise<Lookup & { readonly commonDir: string }> {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-grown-"));
  dirs.push(root);
  return { ...(await lookup(root)), commonDir: join(root, ".git") };
}

function keyOf(keys: WorktreeKeys, ref: TestFileRef): CheckKey {
  const key = keys.index.key(ref);
  if (key === null) throw new Error(`${ref.path} has no key`);
  return key;
}

/**
 * A keeper of `at` expects `files` at their keys, their run completes them
 * with `a`'s reads, `between` runs after the run's decision, then `flush`.
 * Returns the key `a` ran under.
 */
async function keep(
  at: Lookup & { readonly commonDir: string },
  notes: string[],
  options: { files?: readonly TestFileRef[]; between?: () => void; busyBoundMs?: number } = {},
): Promise<CheckKey> {
  const { files = [A], between, busyBoundMs } = options;
  const keeper = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: POLICY,
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
    ...(busyBoundMs === undefined ? {} : { busyBoundMs }),
  });
  const ran = keyOf(at.keys, A);
  keeper.expect("vitest", at.keys, at.hasher, new Map(files.map((f) => [f, keyOf(at.keys, f)])));
  const report: RunReport = {
    end: "completed",
    durationMs: 1,
    completedFiles: [...files],
    results: [],
    fileErrors: [],
    failure: null,
    observed: [A_READ],
  };
  const records = new Map(files.map((f) => [testFileId(f), { record: RECORD }]));
  await keeper.ran({ runner: "vitest", files: [...files], report, records });
  between?.();
  await keeper.flush();
  return ran;
}

/** The results stored at `key`. */
function resultsAt(commonDir: string, key: CheckKey): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key);
    return Number(row?.n);
  } finally {
    db.close();
  }
}

/** `a`'s entry in each shared row: observed, direct, modules. */
function rowsOf(commonDir: string): (readonly string[] | undefined)[] {
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    const keys = [observedMetaKey(""), observedDirectMetaKey(""), observedModulesMetaKey("")];
    return keys.map((key) => readSharedEntries(store, key)[A.path]);
  } finally {
    store.close();
  }
}

describe("squeal code keeps a file whose run read beyond its key (row 020-39)", () => {
  it("at the key with the read, which joins the shared rows with its marks", async () => {
    const at = await worktree();
    const notes: string[] = [];

    const ran = await keep(at, notes);

    const grown = keyOf(at.keys, A);
    expect(grown).not.toBe(ran);
    expect([resultsAt(at.commonDir, grown), resultsAt(at.commonDir, ran)]).toEqual([1, 0]);
    expect(rowsOf(at.commonDir)).toEqual([[READ], [READ], ["src/a.ts"]]);
    expect(notes).toEqual([]);
  });

  it("keeps nothing, and merges nothing, while the store stays busy past the bound", async () => {
    const at = await worktree();
    const notes: string[] = [];
    const store = openStore(at.commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    store.close();
    const holder = new DatabaseSync(storePaths(at.commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    try {
      await keep(at, notes, { busyBoundMs: 600 });
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(
      /^the store is busy \(.+\); waiting up to 0\.6 s to keep 1 completed test file: test\/a\.test\.ts$/,
    );
    expect(notes[1]).toMatch(
      /^1 completed test file was not kept in the stores: the store stayed busy for 0\.6 s \(.+\); the next run will run it again$/,
    );
    expect(resultsAt(at.commonDir, keyOf(at.keys, A))).toBe(0);
    expect(rowsOf(at.commonDir)).toEqual([undefined, undefined, undefined]);
  });

  it("keeps nothing at that key once its read moved before the write, and merges the read", async () => {
    const at = await worktree();
    const notes: string[] = [];

    await keep(at, notes, {
      between: () => {
        writeTree(at.root, { [READ]: "other\n" });
        const later = new Date(Date.now() + 60_000);
        utimesSync(join(at.root, READ), later, later);
      },
    });

    expect(resultsAt(at.commonDir, keyOf(at.keys, A))).toBe(0);
    expect(rowsOf(at.commonDir)[0]).toEqual([READ]);
    expect(notes).toEqual([]);
  });

  it("does not keep it, and merges nothing, while a daemon serves the worktree", async () => {
    const served_ = await served();
    const at = { ...(await lookup(served_.root)), commonDir: served_.commonDir };
    const notes: string[] = [];

    await keep(at, notes, { files: [A, B] });

    expect(served_.keeps.map((k) => [k.write.kind, k.write.key])).toEqual([
      ["coverage", keyOf(at.keys, B)],
      ["results", keyOf(at.keys, B)],
    ]);
    expect(notes).toEqual([
      `1 completed test file was not kept in the stores, because it read paths its key lacks (${READ}): test/a.test.ts; the next run will run it again`,
    ]);
    expect(rowsOf(at.commonDir)).toEqual([undefined, undefined, undefined]);
  });
});
