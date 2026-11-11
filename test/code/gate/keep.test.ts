import { describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import { refKey } from "../../../src/core/code/gate/records.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D17.3 (row 020-17c): what the keeper writes is the CLI cases'
 * (`test/cli/code-gate-keep*.test.ts`). Here: it never reaches the write
 * for a file that did not complete or has no record, and a failure while
 * keeping costs only the write, told once, and never fails the gate.
 */

const REF: TestFileRef = { project: "", path: "test/a.test.ts" };
const KEY = "k".repeat(64) as CheckKey;
const RECORD = { v: 1, sources: [], unread: [] } as never;

/** Keys with no input to compare and nothing observed, as far as the keeper asks. */
const KEYS = {
  cache: new StatCache(),
  stabilityPaths: () => [],
  beginRun: () => 1,
  endRun: () => {},
  observes: () => false,
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
  records: new Map([[refKey(REF), { record: record as never }]]),
});

describe("Keeper (spec 020 D17.3)", () => {
  it.each([
    ["did not complete", [], RECORD],
    ["has no record", [REF], null],
  ])("writes nothing of a file that %s", async (_, completed, record) => {
    const notes: string[] = [];
    const reached = () => Promise.reject(new Error("the write was reached"));

    await keeper(reached, notes).ran(run(completed, record));

    expect(notes).toEqual([]);
  });

  it("tells a failure once and never throws it", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("no head")), notes);

    await expect(keep.ran(run([REF], RECORD))).resolves.toBeUndefined();
    keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
    await keep.ran(run([REF], RECORD));

    // The root does not exist, so the write fails at its first step; it is told once.
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^the gate kept no more results in the stores: /);
  });

  it("does nothing for a runner it was not told of", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("the write was reached")), notes);

    await keep.ran({ ...run([REF], RECORD), runner: "node-test" });

    expect(notes).toEqual([]);
  });
});
