import { describe, expect, it } from "vitest";
import { type FileState, newFileState } from "../../src/core/scheduler/files.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { type RankedFile, startsSooner } from "../../src/core/scheduler/yield-sooner.js";
import type { CheckKey } from "../../src/core/types/index.js";

/*
 * Row 011-263 (spec 011 C4 step 5 and C15 Rank as amended 2026-10-28; the
 * coordinator chose the rule, request 143b0a81): a tier yields to a promoted
 * file only when the files that would run before it after the cut end, by
 * last-known durations, before the tier's estimated remainder. The rule
 * alone, on the numbers that tell it apart; `tier-yields-next-tier.test.ts`
 * runs it in the scheduler.
 */
const S = 1_000;

/** A test file that ran before, `ms` last time; `failing` when that run failed. */
function file(path: string, ms: number | null, failing = false): FileState {
  const state = newFileState({ project: "", path });
  state.durationMs = ms;
  state.resultKey = `k:${path}` as CheckKey;
  state.failing = failing;
  return state;
}

/** A file of the tier, promoted by the wait of request order `rank`, or by none. */
function ranked(state: FileState, rank: number | null = null): RankedFile {
  return { file: state, rank: rank === null ? null : { rank, until: Number.POSITIVE_INFINITY } };
}

/** `count` files of the tier named `prefix`, `ms` each, promoted by the wait of request order `rank`. */
const same = (count: number, ms: number, rank: number | null, failing = false, prefix = "s") =>
  Array.from({ length: count }, (_, i) =>
    ranked(file(`test/${prefix}${i}.test.ts`, ms, failing), rank),
  );

/** Whether a cut of `files`, run `elapsedMs`, starts Q of `qMs`, queued as transitive by request order 1. */
function sooner(files: readonly RankedFile[], elapsedMs: number, qMs: number | null): boolean {
  const longest = Math.max(0, ...files.map((f) => f.file.durationMs ?? 0));
  const remainderMs = longest - elapsedMs;
  const q = { file: file("f/q.test.ts", qMs), rank: 1, priority: Priority.transitive };
  return startsSooner({ files, size: 4, past: remainderMs < 0, remainderMs }, q, NONE_CUT);
}

describe("a cut starts a promoted file before the tier's remainder (row 011-263)", () => {
  it("F3: three 308 s files an earlier wait selected run again first, past the 298 s left", () => {
    expect(sooner(same(3, 308 * S, 0), 10 * S, 1)).toBe(false);
  });

  it("a backlog tier: C, 2 s, an earlier wait's, runs again first, and Q of 60 s starts 2 s after the cut", () => {
    const files = [
      ranked(file("test/c.test.ts", 2 * S), 0),
      ranked(file("test/l.test.ts", 300 * S)),
    ];
    expect(sooner(files, 10 * S, 60 * S)).toBe(true);
  });

  it("an edit's tier: L of 150 s, no wait's, shares C's tier again, ahead of Q", () => {
    const files = [
      ranked(file("test/c.test.ts", 40 * S), 0),
      ranked(file("test/l.test.ts", 150 * S)),
    ];
    // C and L run again for 150 s; the tier had 140 s left.
    expect(sooner(files, 10 * S, 200 * S)).toBe(false);
  });

  it("an earlier wait's files of no known duration count 0: the tier yields as before", () => {
    const files = [
      ranked(file("test/c.test.ts", null), 0),
      ranked(file("test/l.test.ts", 300 * S)),
    ];
    expect(sooner(files, 10 * S, 60 * S)).toBe(true);
  });

  it("Q shares the next tier with the earlier wait's file: the tier yields; four of them leave it no room", () => {
    const files = [...same(1, 200 * S, 0, false, "a"), ...same(3, 200 * S, null)];
    expect(sooner(files, 10 * S, 100 * S)).toBe(true);
    expect(sooner(same(4, 200 * S, 0), 10 * S, 100 * S)).toBe(false);
  });

  it("the same wait ranks the cut files and Q: C4's order decides, the class first, then the duration", () => {
    // Q's 1 ms goes before the 308 s files of its own class.
    expect(sooner(same(3, 308 * S, 1), 10 * S, 1)).toBe(true);
    // A failing file goes before Q, which is transitive.
    expect(sooner(same(3, 308 * S, 1, true), 10 * S, 1)).toBe(false);
  });

  it("no cut file ranks before Q: it leads the next tier, even past the tier's estimate", () => {
    expect(sooner(same(4, 20 * S, null), 60 * S, 1)).toBe(true);
    expect(sooner(same(4, 20 * S, 2), 60 * S, 1)).toBe(true);
  });
});
