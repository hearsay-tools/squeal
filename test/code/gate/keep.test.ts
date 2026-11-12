import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D17.3 (row 020-17c): what the keeper writes is the CLI cases'
 * (`test/cli/code-gate-keep*.test.ts`), and which completed file it may
 * keep is the run evidence table's (`test/run-evidence/table.test.ts`, row
 * 011-319). Here: it never reaches the write for a file with no record,
 * and a failure while keeping costs only the write, told once, and never
 * fails the gate. D17.5 (row 020-28): a run only queues its files, and
 * `flush` writes them; a busy store is `keep-busy.test.ts`'s.
 */

const REF: TestFileRef = { project: "", path: "test/a.test.ts" };
const KEY = "k".repeat(64) as CheckKey;
const RECORD = { v: 1, sources: [], unread: [] } as never;

/** Keys with no input to compare, as far as the keeper asks of a run that read nothing. */
const KEYS = {
  cache: new StatCache(),
  stabilityPaths: () => [],
  beginRun: () => 1,
  endRun: () => {},
} as unknown as WorktreeKeys;

const HASHER: Hasher = { stat: async () => null, hash: async () => null, now: () => 0 };

function report(completed: readonly TestFileRef[]): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: completed,
    results: [],
    fileErrors: [],
    failure: null,
  };
}

function keeper(head: () => Promise<never>, notes: string[]): Keeper {
  const keep = new Keeper({
    root: "/nowhere",
    commonDir: "/nowhere/.git",
    policy: DEFAULT_POLICY,
    head,
    note: (text) => notes.push(text),
  });
  keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
  return keep;
}

const run = (completed: readonly TestFileRef[], record: unknown) => ({
  runner: "vitest" as const,
  files: [REF],
  report: report(completed),
  records: new Map([[testFileId(REF), { record: record as never }]]),
});

describe("Keeper (spec 020 D17.3)", () => {
  it("writes nothing of a file that has no record", async () => {
    const notes: string[] = [];
    const reached = () => Promise.reject(new Error("the write was reached"));

    const keep = keeper(reached, notes);
    await keep.ran(run([REF], null));
    await keep.flush();

    expect(notes).toEqual([]);
  });

  it("writes nothing until `flush` (D17.5)", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("the write was reached")), notes);

    await keep.ran(run([REF], RECORD));
    expect(notes).toEqual([]);

    // The root does not exist, so the write fails at its first step.
    await keep.flush();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^1 completed test file was not kept in the stores: /);
  });

  it("tells a failure once and never throws it", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("no head")), notes);

    await keep.ran(run([REF], RECORD));
    await expect(keep.flush()).resolves.toBeUndefined();
    keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
    await keep.ran(run([REF], RECORD));
    await keep.flush();

    // The root does not exist, so the write fails at its first step; it is told once.
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^1 completed test file was not kept in the stores: /);
  });

  it("keeps each lookup of one runner kind apart, and ends each run once (review 0.1.433 B2)", async () => {
    const runs = { begun: 0, inFlight: 0 };
    const keys = {
      ...KEYS,
      beginRun: () => {
        runs.inFlight += 1;
        runs.begun += 1;
        return runs.begun;
      },
      endRun: () => {
        runs.inFlight -= 1;
      },
    } as unknown as WorktreeKeys;
    // Each flush with files starts its write with the head, which fails here and counts the files.
    let writes = 0;
    const notes: string[] = [];
    const keep = new Keeper({
      // A root that exists, so the write reaches the head; nothing is written after it.
      root: tmpdir(),
      commonDir: "/nowhere/.git",
      policy: DEFAULT_POLICY,
      head: () => Promise.reject(new Error(`write ${++writes}`)),
      note: (text) => notes.push(text),
    });
    const ref = (project: string): TestFileRef => ({ project, path: "test/x.test.mjs" });
    const [a, b, c] = [ref("a"), ref("b"), ref("c")];
    const ranOf = (ref: TestFileRef) => ({
      runner: "node-test" as const,
      files: [ref],
      report: report([ref]),
      records: new Map([[testFileId(ref), { record: RECORD }]]),
    });
    for (const one of [a, b, c]) keep.expect("node-test", keys, HASHER, new Map([[one, KEY]]));
    keep.expect("node-test", keys, HASHER, new Map());
    expect(runs).toEqual({ begun: 3, inFlight: 3 });

    await keep.ran(ranOf(a));
    await keep.ran(ranOf(a));
    await keep.ran(ranOf(b));
    expect(runs.inFlight).toBe(1);
    await keep.flush();
    // `a` once and `b`: the second run of `a` found its lookup taken.
    expect(notes).toEqual(["2 completed test files were not kept in the stores: write 1"]);

    // `c`'s runner never ran: closing ends its run, and a late completion keeps nothing.
    keep.close();
    await keep.ran(ranOf(c));
    await keep.flush();
    expect([writes, runs.inFlight]).toEqual([1, 0]);
  });

  it("does nothing for a runner it was not told of", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("the write was reached")), notes);

    await keep.ran({ ...run([REF], RECORD), runner: "node-test" });
    await keep.flush();

    expect(notes).toEqual([]);
  });
});
