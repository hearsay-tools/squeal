import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../src/core/code/gate/keep.js";
import { NotKept } from "../../src/core/code/gate/keep-reasons.js";
import { POLICY_FILE, readPolicy } from "../../src/core/daemon/policy.js";
import type { Hasher } from "../../src/core/hash/hasher.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import {
  type FileDecision,
  mergeHoldOf,
  type Revisions,
  type RuntimeSource,
  unheldNow,
} from "../../src/core/run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { CommitSha, EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { git, scratchStore, writeTree } from "../keys/validity/harness/shared.js";

/*
 * Row 011-320: the sources `squeal code`'s keeper reads beyond row 011-319's,
 * through a real `Keeper` over a real store. The decision of each is the
 * table's (`table.test.ts`, rows "difference 2" to "difference 4"); here,
 * that the keeper reads them. Difference 2: the runtime identity, from the
 * source `Keeper.expect` is given, before the run and at its end; without
 * the source no identity is compared. Difference 3 (spec 011 C9): the merge
 * hold, read as the daemon's `MergeHold` reads it, at the decision and again
 * at each write, as the daemon's record reads its hold at each try
 * (`TierRecords.#heldNow`).
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const KEY_A = "a".repeat(64) as CheckKey;
const INPUT = "src/a.mjs";
const RECORD = { v: 1, sources: [], unread: [] } as never;
const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose one commit holds `src/a.mjs` and `src/b.mjs`. */
function repository(): string {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-hold-"));
  dirs.push(scratch);
  const root = writeTree(join(scratch, "repo"), {
    [INPUT]: "export const a = 1;\n",
    "src/b.mjs": "export const b = 2;\n",
  });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

/** Marks `path` unmerged, its three stages at the bytes it holds, as a conflicted merge leaves it. */
function unmerge(root: string, path: string): void {
  const blob = git(root, ["rev-parse", `:${path}`]).trim();
  const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}`);
  const input = [`0 ${"0".repeat(blob.length)}\t${path}`, ...stages].join("\n");
  execFileSync("git", ["update-index", "--index-info"], { cwd: root, input: `${input}\n` });
}

describe("squeal code's merge hold (row 011-320, 011 C9)", () => {
  it("names the unmerged index paths, and reads them again once the index moved", async () => {
    const root = repository();
    const hold = mergeHoldOf(root);
    const files = [{ paths: [INPUT] }, { paths: ["src/b.mjs"] }];

    expect(await unheldNow(hold, files)).toEqual(files);
    unmerge(root, INPUT);
    expect(await unheldNow(hold, files)).toEqual([files[1]]);
    git(root, ["add", INPUT]);
    expect(await unheldNow(hold, files)).toEqual(files);
  });

  it("holds nothing where git reads no index, as the daemon's hold before its first read", async () => {
    const files = [{ paths: [INPUT] }];

    expect(await unheldNow(mergeHoldOf("/nowhere"), files)).toEqual(files);
  });

  it.each([
    ["writes the file when no merge holds it", false, 1],
    ["does not write a file a merge holds by its write", true, 0],
  ])("%s", async (_, merging, results) => {
    const root = repository();
    const notes: string[] = [];

    await keepA(root, notes, {
      // After the run's decision, before the write: a merge leaves the file's input unmerged.
      ran: () => {
        if (merging) unmerge(root, INPUT);
      },
    });

    expect([resultsAt(join(root, ".git")), notes]).toEqual([results, []]);
  });
});

describe("squeal code's runtime identity (row 011-320, difference 2)", () => {
  it.each([
    ["writes the file whose runtime identity held", "node 26", "node 26", 1],
    ["does not write a file whose runtime identity moved during the run", "node 26", "node 24", 0],
    ["compares no identity without the source", undefined, undefined, 1],
  ])("%s", async (_, before, after, results) => {
    const root = repository();
    const notes: string[] = [];
    let identity = before;
    const rules = readPolicy(root);
    const runtime =
      before === undefined
        ? undefined
        : { identity: () => identity ?? "", rules, rulesNow: () => readPolicy(root) };

    await keepA(root, notes, {
      ...(runtime === undefined ? {} : { runtime }),
      started: () => {
        identity = after;
      },
    });

    expect(resultsAt(join(root, ".git"))).toBe(results);
    expect(notes).toEqual(
      results === 1
        ? []
        : [
            "1 completed test file was not kept in the stores, because the runtime's identity moved during the run: test/a.test.ts; the next run will run it again",
          ],
    );
  });

  it.each([
    [
      "writes the file when the policy's runtime files for another test file moved",
      "test/b.test.ts",
      1,
    ],
    [
      "does not write a file whose runtime files the policy changed during the run (review 0.1.458 B3)",
      "test/a.test.ts",
      0,
    ],
  ])("%s", async (_, tests, results) => {
    const root = repository();
    const notes: string[] = [];
    const rules = readPolicy(root);
    // Its keys give one identity throughout: they keep the lookup's policy.
    const runtime = { identity: () => "", rules, rulesNow: () => readPolicy(root) };
    const policy = { runtimeFiles: [{ project: "", tests: [tests], paths: ["runtime.txt"] }] };

    await keepA(root, notes, {
      runtime,
      started: () => writeTree(root, { [POLICY_FILE]: `${JSON.stringify(policy)}\n` }),
    });

    expect([resultsAt(join(root, ".git")), notes.length]).toEqual([results, 1 - results]);
  });
});

describe("squeal code's revisions during the run (review 0.1.458 B1)", () => {
  it.each([
    ["writes the file when no revision moved what it lists", [], 1],
    [
      "does not write a file whose listed directory a revision gained a file in and a later one lost it",
      ["src/new.mjs", null],
      0,
    ],
  ] as const)("%s", async (_, came, results) => {
    const root = repository();
    const notes: string[] = [];
    // The repository's store, where a serving daemon records the worktree's revisions.
    const store = scratchStore(join(root, "..", "repository-store"));
    const worktreeId = "served" as WorktreeId;
    const revise = (path: string, from: string | null, to: string | null) =>
      store.revisions.append({
        worktreeId,
        createdAt: 1 as EpochMs,
        head: "a".repeat(40) as CommitSha,
        dirty: true,
        trigger: "watch",
        changes: [{ path, oldHash: from, newHash: to }],
      });
    revise("src/b.mjs", "h", "i");
    try {
      await keepA(root, notes, {
        listing: true,
        revisions: { store, worktreeId },
        started: () => {
          if (came.length === 0) return;
          revise("src/new.mjs", null, "n");
          revise("src/new.mjs", "n", null);
        },
      });
    } finally {
      store.close();
    }

    expect(resultsAt(join(root, ".git"))).toBe(results);
    expect(notes).toEqual(
      results === 1
        ? []
        : [
            "1 completed test file was not kept in the stores, because a file was added to or removed from a directory its key lists (src/): test/a.test.ts; the next run will run it again",
          ],
    );
  });
});

describe("squeal code's note on the files it did not keep (row 011-320)", () => {
  const decided = (kind: string, paths: string[], reason = "") =>
    ({ cause: { kind, paths }, reason }) as unknown as FileDecision;

  it("tells one line per kind of evidence, naming the test files and the paths behind it", () => {
    const notKept = new NotKept();
    notKept.add("test/b.test.ts", decided("unstable", ["src/b.ts"]));
    notKept.add("test/h.test.ts", decided("held", []));
    notKept.add("test/a.test.ts", decided("unstable", ["src/", "src/a.ts"]));
    notKept.add("test/w.test.ts", decided("withheld", [], "the runner withheld the run"));
    notKept.add("test/l.test.ts", decided("listing", ["src/"]));

    expect(notKept.take()).toEqual([
      "2 completed test files were not kept in the stores, because what their keys name changed during the run (src/, src/a.ts, src/b.ts): test/a.test.ts, test/b.test.ts; the next run will run them again",
      "1 completed test file was not kept in the stores, because a merge holds a path its key names: test/h.test.ts; the next run will run it again",
      "1 completed test file was not kept in the stores, because the runner withheld the run: test/w.test.ts; the next run will run it again",
      "1 completed test file was not kept in the stores, because a file was added to or removed from a directory its key lists (src/): test/l.test.ts; the next run will run it again",
    ]);
    expect(notKept.take()).toEqual([]);
  });

  it("names the first three test files and paths in path order, then how many more", () => {
    const notKept = new NotKept();
    for (const name of ["e", "d", "c", "b", "a"]) {
      notKept.add(`test/${name}.test.ts`, decided("grown", [`data/${name}.txt`, "data/z.txt"]));
    }

    expect(notKept.take()).toEqual([
      "5 completed test files were not kept in the stores, because they read paths their keys lack (data/a.txt, data/b.txt, data/c.txt and 3 more): test/a.test.ts, test/b.test.ts, test/c.test.ts and 2 more; the next run will run them again",
    ]);
  });
});

/**
 * A keeper of `root` expects `test/a.test.ts` at `KEY_A`, its run completes
 * it, and `flush` writes what it kept. `started` runs after the lookup and
 * before the run ends, `ran` after the run's decision and before the write.
 */
async function keepA(
  root: string,
  notes: string[],
  at: {
    runtime?: RuntimeSource;
    revisions?: Revisions;
    listing?: boolean;
    started?: () => void;
    ran?: () => void;
  },
): Promise<void> {
  const keep = new Keeper({
    root,
    commonDir: join(root, ".git"),
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
  });
  const sources = {
    ...(at.runtime === undefined ? {} : { runtime: at.runtime }),
    ...(at.revisions === undefined ? {} : { revisions: at.revisions }),
  };
  const keys = keysOf(at.listing === true ? [INPUT, "src/"] : [INPUT]);
  keep.expect("vitest", keys, HASHER, new Map([[A, KEY_A]]), sources);
  at.started?.();
  await keep.ran({
    runner: "vitest",
    files: [A],
    report: {
      end: "completed",
      durationMs: 1,
      completedFiles: [A],
      results: [],
      fileErrors: [],
      failure: null,
    },
    records: new Map([[testFileId(A), { record: RECORD }]]),
  });
  at.ran?.();
  await keep.flush();
}

/** Inputs that never move: every stat and hash is the one the lookup copied. */
const HASHER: Hasher = { stat: async () => STAT, hash: async () => "h", now: () => 1_000_000 };

/** A lookup's keys over the repository's two files, `test/a.test.ts` reading `paths`. */
function keysOf(paths: readonly string[]): WorktreeKeys {
  const files = [INPUT, "src/b.mjs"].map((path) => ({ path, ...STAT, hash: "h" }));
  return {
    cache: new StatCache(files),
    stabilityPaths: () => paths,
    beginRun: () => 1,
    endRun: () => {},
    observes: () => false,
    environmentFiles: () => [],
    extraFiles: () => [],
  } as unknown as WorktreeKeys;
}

/** The results stored at `KEY_A`; none while there is no store. */
function resultsAt(commonDir: string): number {
  const path = storePaths(commonDir).database;
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(KEY_A);
    return Number(row?.n);
  } finally {
    db.close();
  }
}
