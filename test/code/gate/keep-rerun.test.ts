import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { GateRun } from "../../../src/core/code/gate/collect.js";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { POLICY, RECORD } from "./keep-daemon-kit.js";
import { A, B, keyOf, type Worktree, worktree } from "./keep-grown-kit.js";

/*
 * Row 020-55 (spec 020 D17.3, D3.4): the keeper keeps the result of a file
 * the gate ran once more under load, from its rerun, at the key its lookup
 * gave it, as the daemon's rerun replaces its row. The first run's failure
 * is never kept. The window its inputs must hold still over runs from the
 * lookup to the rerun's end, so an input edited during either run bars the
 * keep. Real keys over a scratch store, and the repository's store, with
 * no daemon (`keep-grown-kit.ts`). The CLI case: `code-gate-retry.test.ts`.
 */

type Outcome = "pass" | "fail";

/** A run's report: each of `ends` completed with its outcome. */
function report(ends: ReadonlyMap<TestFileRef, Outcome>): RunReport {
  const files = [...ends.keys()];
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: files,
    results: files.map((ref) => ({
      check: { kind: "test", project: ref.project, testPath: ref.path, fullName: "works" },
      outcome: ends.get(ref) ?? "pass",
      durationMs: 1,
      location: null,
      errors: [],
    })),
    fileErrors: [],
    failure: null,
  };
}

/** `files` run with their `ends`, each with a record, as `lanes.ts` tells it, naming `retrying`. */
function ran(ends: ReadonlyMap<TestFileRef, Outcome>, retrying?: readonly TestFileRef[]): GateRun {
  const files = [...ends.keys()];
  return {
    runner: "vitest",
    files,
    report: report(ends),
    records: new Map(files.map((f) => [testFileId(f), { record: RECORD }])),
    ...(retrying === undefined ? {} : { retrying }),
  };
}

/** The outcomes of each run's test, `works`, stored at `key`. */
function outcomesAt(commonDir: string, key: CheckKey): string[] {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT r.outcome FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key = ? AND c.full_name = 'works'",
      )
      .all(key);
    return rows.map((row) => String(row.outcome));
  } finally {
    db.close();
  }
}

interface Steps {
  /** After the lookup, before the first run's tell: during the first run. */
  readonly first?: () => void;
  /** After the first run's tell, before the rerun's: during the rerun. */
  readonly rerun?: () => void;
  /** The rerun's outcome; `null`: the rerun never started, so the keeper never hears it. */
  readonly again?: Outcome | null;
}

/**
 * The gate's keeper over `at`: `a` and `b` looked up, their first run
 * fails `a` under load, so `a` runs once more; then `flush` and `close`.
 * Returns each file's lookup key, the notes and how often the lookup's run
 * of keys ended at each step.
 */
async function retried(at: Worktree, { first, rerun, again = "pass" }: Steps = {}) {
  const notes: string[] = [];
  const keeper = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: POLICY,
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => notes.push(text),
  });
  const keys = { a: keyOf(at.keys, A), b: keyOf(at.keys, B) };
  const ended = vi.spyOn(at.keys, "endRun");
  const runEnds: number[] = [];
  keeper.expect(
    "vitest",
    at.keys,
    at.hasher,
    new Map([
      [A, keys.a],
      [B, keys.b],
    ]),
  );
  first?.();
  await keeper.ran(
    ran(
      new Map<TestFileRef, Outcome>([
        [A, "fail"],
        [B, "pass"],
      ]),
      [A],
    ),
  );
  runEnds.push(ended.mock.calls.length);
  rerun?.();
  if (again !== null) await keeper.ran(ran(new Map([[A, again]])));
  runEnds.push(ended.mock.calls.length);
  await keeper.flush();
  keeper.close();
  runEnds.push(ended.mock.calls.length);
  ended.mockRestore();
  return { keys, notes, runEnds };
}

const edit = (at: Worktree) => () =>
  writeFileSync(join(at.root, "src/a.ts"), "export const a = 10;\n");

/** Each case opens a repository and its keys; a busy host's load slows that, never the logic. */
const SLOW = { timeout: 60_000 };

describe("the keeper keeps a retried file's rerun result (row 020-55)", SLOW, () => {
  it("at the lookup's key, with the rerun's outcome; the run of keys ends once, at the rerun", async () => {
    const at = await worktree();

    const { keys, notes, runEnds } = await retried(at);

    expect(outcomesAt(at.commonDir, keys.a)).toEqual(["pass"]);
    expect(outcomesAt(at.commonDir, keys.b)).toEqual(["pass"]);
    expect(notes).toEqual([]);
    // Held open past the first run's tell, ended by the rerun's, not again by `close`.
    expect(runEnds).toEqual([0, 1, 1]);
  });

  it("keeps a rerun that failed again, failed", async () => {
    const at = await worktree();

    const { keys } = await retried(at, { again: "fail" });

    expect(outcomesAt(at.commonDir, keys.a)).toEqual(["fail"]);
  });

  it("never keeps the first failure, record and all: with no rerun, `close` ends the run", async () => {
    const at = await worktree();

    const { keys, notes, runEnds } = await retried(at, { again: null });

    expect(outcomesAt(at.commonDir, keys.a)).toEqual([]);
    expect(outcomesAt(at.commonDir, keys.b)).toEqual(["pass"]);
    expect(notes).toEqual([]);
    expect(runEnds).toEqual([0, 0, 1]);
  });

  it("does not keep it when an input was edited during the rerun", async () => {
    const at = await worktree();

    const { keys, notes } = await retried(at, { rerun: edit(at) });

    expect(outcomesAt(at.commonDir, keys.a)).toEqual([]);
    expect(outcomesAt(at.commonDir, keys.b)).toEqual(["pass"]);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores, because what its key names changed during the run (src/a.ts): test/a.test.ts; the next run will run it again",
    ]);
  });

  it("does not keep it when an input was edited during the first run, before the rerun", async () => {
    const at = await worktree();

    const { keys, notes } = await retried(at, { first: edit(at) });

    // The window runs from the lookup, not from the rerun's start.
    expect(outcomesAt(at.commonDir, keys.a)).toEqual([]);
    expect(outcomesAt(at.commonDir, keys.b)).toEqual(["pass"]);
    expect(notes).toEqual([
      "1 completed test file was not kept in the stores, because what its key names changed during the run (src/a.ts): test/a.test.ts; the next run will run it again",
    ]);
  });
});
