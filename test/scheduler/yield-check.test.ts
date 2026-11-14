import { describe, expect, it } from "vitest";
import { type FileState, newFileState } from "../../src/core/scheduler/files.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { type CutFiles, NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { type RankedFile, startsSooner } from "../../src/core/scheduler/yield-view.js";
import type { CheckKey } from "../../src/core/types/keys.js";

/*
 * Row 011-348 (`research/tier-plan.md`, decision 2; row 011-263, spec 011
 * C4 step 5 and C15 Rank as amended 2026-10-28): a tier yields to a
 * promoted file only when the files that would run before it after the cut
 * end, by last-known durations, before the tier's estimated remainder. The
 * check asks the tier plan over a view of the cut files and the waiting
 * file; these rows were `yield-sooner.test.ts`'s and the cuts
 * `tier-yields-next-tier.test.ts` would ask about, on which the plan gave
 * the answer of the model it replaced (commit da4963d76, with 3,000 seeded
 * cuts).
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
  return { file: state, rank: rank === null ? null : { rank } };
}

/** `count` files of the tier named `prefix`, `ms` each, promoted by the wait of request order `rank`. */
const same = (count: number, ms: number, rank: number | null, failing = false, prefix = "s") =>
  Array.from({ length: count }, (_, i) =>
    ranked(file(`test/${prefix}${i}.test.ts`, ms, failing), rank),
  );

/** A cut of `files`, run `elapsedMs`, and Q of `qMs` queued by request order `qRank`. */
interface Case {
  readonly name: string;
  readonly files: readonly RankedFile[];
  readonly elapsedMs: number;
  readonly qMs: number | null;
  readonly qRank?: number;
  readonly priority?: Priority;
  readonly size?: number;
  readonly marks?: CutFiles;
  readonly sooner: boolean;
}

/** Whether a cut of `c` starts Q before the tier's remainder. */
function sooner(c: Case): boolean {
  const longest = Math.max(0, ...c.files.map((f) => f.file.durationMs ?? 0));
  const remainderMs = longest - c.elapsedMs;
  const q = {
    file: file("f/q.test.ts", c.qMs),
    rank: c.qRank ?? 1,
    priority: c.priority ?? Priority.transitive,
  };
  const cut = { files: c.files, size: c.size ?? 4, past: remainderMs < 0, remainderMs };
  const marks = c.marks ?? NONE_CUT;
  return startsSooner(cut, q, marks);
}

const CASES: readonly Case[] = [
  // yield-sooner.test.ts
  {
    name: "F3: three 308 s files an earlier wait selected run again first, past the 298 s left",
    files: same(3, 308 * S, 0),
    elapsedMs: 10 * S,
    qMs: 1,
    sooner: false,
  },
  {
    name: "a backlog tier: C, 2 s, an earlier wait's, runs again first, and Q of 60 s starts 2 s after",
    files: [ranked(file("test/c.test.ts", 2 * S), 0), ranked(file("test/l.test.ts", 300 * S))],
    elapsedMs: 10 * S,
    qMs: 60 * S,
    sooner: true,
  },
  {
    name: "an edit's tier: L of 150 s, no wait's, shares C's tier again, ahead of Q",
    files: [ranked(file("test/c.test.ts", 40 * S), 0), ranked(file("test/l.test.ts", 150 * S))],
    elapsedMs: 10 * S,
    qMs: 200 * S,
    sooner: false,
  },
  {
    name: "an earlier wait's files of no known duration count 0: the tier yields as before",
    files: [ranked(file("test/c.test.ts", null), 0), ranked(file("test/l.test.ts", 300 * S))],
    elapsedMs: 10 * S,
    qMs: 60 * S,
    sooner: true,
  },
  {
    name: "Q shares the next tier with the earlier wait's file",
    files: [...same(1, 200 * S, 0, false, "a"), ...same(3, 200 * S, null)],
    elapsedMs: 10 * S,
    qMs: 100 * S,
    sooner: true,
  },
  {
    name: "four of the earlier wait's files leave Q no room in the next tier",
    files: same(4, 200 * S, 0),
    elapsedMs: 10 * S,
    qMs: 100 * S,
    sooner: false,
  },
  {
    name: "the same wait ranks the cut files and Q: Q's 1 ms goes before 308 s files of its class",
    files: same(3, 308 * S, 1),
    elapsedMs: 10 * S,
    qMs: 1,
    sooner: true,
  },
  {
    name: "the same wait ranks the cut files and Q: a failing file goes before Q, which is transitive",
    files: same(3, 308 * S, 1, true),
    elapsedMs: 10 * S,
    qMs: 1,
    sooner: false,
  },
  {
    name: "no cut file ranks before Q: it leads the next tier, past the tier's estimate",
    files: same(4, 20 * S, null),
    elapsedMs: 60 * S,
    qMs: 1,
    sooner: true,
  },
  {
    name: "no cut file ranks before Q: a later wait's files go after it",
    files: same(4, 20 * S, 2),
    elapsedMs: 60 * S,
    qMs: 1,
    sooner: true,
  },
  // tier-yields-next-tier.test.ts: the rank rule (row 011-268) decides there before this check
  // runs; these are the cuts its scenarios would ask about.
  {
    name: "next tier, F3: wait A names the three running files; at 10 s wait B adds Q",
    files: same(3, 308 * S, 0),
    elapsedMs: 10 * S,
    qMs: 1,
    sooner: false,
  },
  {
    name: "next tier: the cut files an earlier wait selected fill the next tier",
    files: same(4, 200 * S, 0),
    elapsedMs: 10 * S,
    qMs: 100 * S,
    sooner: false,
  },
  {
    name: "next tier: Q would share the next tier with the cut file an earlier wait selected",
    files: [...same(1, 200 * S, 0), ...same(3, 200 * S, null, false, "t")],
    elapsedMs: 10 * S,
    qMs: 100 * S,
    sooner: true,
  },
  {
    name: "next tier: A's wait ends before 30 s, and Q comes again at 11 s",
    files: same(3, 308 * S, 0),
    elapsedMs: 11 * S,
    qMs: 1,
    sooner: false,
  },
  {
    name: "Q of 2 s shares the next tier with two 2 s files an earlier wait selected",
    files: [ranked(file("test/c.test.ts", 2 * S), 0), ranked(file("test/d.test.ts", 2 * S), 0)],
    elapsedMs: 0,
    qMs: 2 * S,
    sooner: true,
  },
  {
    name: "Q cut past its estimate by an earlier yield shares no tier with files not so marked",
    files: [ranked(file("test/c.test.ts", 2 * S), 0), ranked(file("test/d.test.ts", 2 * S), 0)],
    elapsedMs: 0,
    qMs: 2 * S,
    marks: { cutPastEstimate: (f) => f.ref.path === "f/q.test.ts" },
    sooner: false,
  },
  {
    name: "a tier of 1: each file ahead takes its own tier, 5 s before the 10 s left",
    files: [
      ranked(file("test/c.test.ts", 2 * S), 0),
      ranked(file("test/d.test.ts", 3 * S), 0),
      ranked(file("test/l.test.ts", 10 * S)),
    ],
    elapsedMs: 0,
    qMs: 4 * S,
    size: 1,
    sooner: true,
  },
  {
    name: "a tier of 1: the files ahead take 5 s of the 4 s left",
    files: [
      ranked(file("test/c.test.ts", 2 * S), 0),
      ranked(file("test/d.test.ts", 3 * S), 0),
      ranked(file("test/l.test.ts", 4 * S)),
    ],
    elapsedMs: 0,
    qMs: 4 * S,
    size: 1,
    sooner: false,
  },
  {
    // The tier's wall estimate at 2 workers is 130 s; an edit's tier runs each file on its own.
    name: "the tier ahead counts its longest file, 100 s, not its wall estimate, against 120 s left",
    files: [
      ranked(file("test/c.test.ts", 100 * S), 0),
      ranked(file("test/d.test.ts", 60 * S), 0),
      ranked(file("test/l.test.ts", 400 * S)),
    ],
    elapsedMs: 280 * S,
    qMs: 1,
    sooner: true,
  },
];

describe("a cut starts a promoted file before the tier's remainder (rows 011-263, 011-348)", () => {
  it.each(CASES)("$name", (c) => {
    expect(sooner(c)).toBe(c.sooner);
  });
});
