import { describe, expect, it } from "vitest";
import { COMMAND_HOLD_MAX_MS } from "../../src/core/scheduler/command-hold.js";
import { Checks, type Closed, type Violation } from "./model-checks.js";
import { Model } from "./model-fixture.js";
import { backlogPlan, type Ev, type Plan, plan, slowPlan } from "./model-plans.js";

/*
 * Row 011-195 (016-18, `research/model-scheduler.md` recommendations 1, 3
 * and 4): six invariants of spec 011 C4 step 5 and C15 Rank and Lifetime,
 * checked (`model-checks.ts`) over the seeded sequences of `model-plans.ts`, rare orders and
 * the sequences of the defects the model found. Each sequence is played
 * once with every invariant checked; each group's case reads its own. Row
 * 011-221 adds G, row 011-211's close of a slow lane's instance (004 D2, 013
 * V1), over sequences with the slow lane beside and command holds.
 */

interface Played {
  readonly found: Violation[];
  /** Each `cross` moved the clock. */
  readonly crossed: boolean;
  readonly closed: ReadonlySet<Closed>;
}

/** One sequence, every invariant checked; it stops at the first violation. */
async function play(p: Plan): Promise<Played> {
  const m = await Model.start(p);
  const checks = new Checks(m, p.kind);
  let crossed = true;
  try {
    for (const [i, ev] of p.events.entries()) {
      checks.at = i + 1;
      checks.eventAt = m.clock.raw();
      if (ev.e === "promote") checks.promoted(ev.files, ev.ms);
      await m.play(ev);
      if (ev.e === "cross") continue;
      if (p.events[i - 1]?.e === "cross") crossed &&= m.clock.crossed;
      checks.steady();
      if (checks.found.length > 0) break;
    }
    if (checks.found.length === 0) await checks.released();
    for (const text of m.errors())
      checks.found.push({ inv: "err", at: checks.at, detail: text.slice(0, 300) });
  } finally {
    await m.close();
  }
  return { found: checks.found, crossed, closed: checks.closed };
}

/** The first violation of `inv` in `p` with a shorter sequence that still shows it, at most 30 deletions tried. */
async function shortest(p: Plan, v: Violation): Promise<string> {
  let events = p.events.slice(0, v.at);
  for (let i = events.length - 1, budget = 30; i >= 0 && budget > 0; i--, budget--) {
    const fewer = events.filter((_, j) => j !== i);
    const again = await play({ ...p, events: fewer });
    if (again.found.some((x) => x.inv === v.inv)) events = fewer;
  }
  return `${p.kind} ${p.slowMs / 1000} s: ${events.map(show).join("; ")}`;
}

function show(ev: Ev): string {
  const { e, ...rest } = ev;
  return `${e} ${Object.values(rest).join(" ")}`;
}

const vitest = (slowMs: number, events: Ev[]): Plan => ({
  seed: 0,
  kind: "vitest",
  slowMs,
  events,
});

/** Row 011-221: the slow lane beside, `events` played once x1 runs alone in it and an edit's fast tier beside. */
const laned = (kind: Plan["kind"], events: Ev[]): Plan => ({
  seed: 0,
  kind,
  slowMs: 35_000,
  slowLane: true,
  events: [
    { e: "edit", path: "src/x.ts" },
    // The start's tiers end; x1 runs alone in the slow lane.
    { e: "finish", slot: 0, crash: false },
    { e: "finish", slot: 0, crash: false },
    // An edit's fast tier runs beside it.
    { e: "edit", path: "src/s.ts" },
    ...events,
  ],
});

/** Row 011-211's three closes, each with a runner that cancels and one that does not. */
const LANED = {
  "the bound passes with x2 queued behind fast work": [
    { e: "finish", slot: 0, crash: false },
    { e: "step", ms: 30_000 },
    { e: "step", ms: 30_000 },
  ],
  "a hold begins with x2 queued and no slow run": [
    { e: "finish", slot: 0, crash: false },
    { e: "hold", ms: COMMAND_HOLD_MAX_MS },
    { e: "step", ms: 60_000 },
    { e: "unhold" },
  ],
  "a hold begins while x1 runs": [
    { e: "hold", ms: COMMAND_HOLD_MAX_MS },
    { e: "step", ms: 5_000 },
    { e: "finish", slot: 0, crash: false },
    { e: "unhold" },
  ],
} satisfies Record<string, Ev[]>;

/** The sequences of the defects the model found and of a past blocker, by name. */
const DIRECTED: Record<string, Plan> = {
  // 016-18 F (row 011-193): the cut dropped the open wait's promotion of s4, queued again.
  "F's reproduction": vitest(200_000, [
    { e: "step", ms: 1_000 },
    { e: "promote", files: ["test/s4.test.ts"], ms: 120_000 },
    { e: "promote", files: ["f/p.test.ts"], ms: 60_000 },
  ]),
  // R398 (review 0.1.296 B1): the protected module's end did not decide the tier again.
  "R398's shortest": vitest(200_000, [
    { e: "promote", files: ["f/p.test.ts"], ms: 60_000 },
    { e: "step", ms: 35_000 },
    { e: "promote", files: ["test/s3.test.ts"], ms: 3_000 },
    { e: "end", slot: 0, file: 0 },
  ]),
  // R427 (wave-4 B1): an old backlog run's crash erased the newer run's state.
  "R427's hand sequence": {
    seed: 0,
    kind: "node",
    slowMs: 20_000,
    events: [
      { e: "finish", slot: 0, crash: false },
      { e: "finish", slot: 0, crash: false },
      { e: "runAll", force: true },
      { e: "step", ms: 1_000 },
      { e: "edit", path: "src/s.ts" },
      { e: "finish", slot: 0, crash: true },
    ],
  },
  // 016-18 open question 1: seed 173 of the probe under `KIND=vitest` (`tasks/011-195/notes.md`).
  "seed 173 vitest": plan(173, 12, "vitest"),
  ...Object.fromEntries(
    Object.entries(LANED).flatMap(([name, events]) =>
      (["vitest", "node"] as const).map((kind) => [`${name}, ${kind}`, laned(kind, events)]),
    ),
  ),
};

/**
 * Recommendation 3: a jump of the clock at each reading in turn of the
 * last event's decision, until a reading past its last. Seed 60's shape
 * (016-18 A, row 011-194) and test 10's of `tier-yields-named.test.ts`.
 */
const SWEEPS: { name: string; base: Plan; ms: number }[] = [
  {
    name: "seed 60's shape",
    base: vitest(20_000, [
      { e: "promote", files: ["test/s4.test.ts", "f/p.test.ts"], ms: 120_000 },
      { e: "promote", files: ["test/s2.test.ts", "test/s3.test.ts"], ms: 120_000 },
    ]),
    ms: 60_000,
  },
  {
    name: "an earlier wait's deadline",
    base: vitest(200_000, [
      { e: "step", ms: 40_000 },
      { e: "promote", files: ["test/s1.test.ts"], ms: 30_000 },
      { e: "promote", files: ["f/p.test.ts"], ms: 60_000 },
    ]),
    ms: 30_000,
  },
];

/**
 * The fixed seeds: the probe's mixed sequences 1 to 24 and 60 (016-18 A),
 * and 6 from a forced backlog. With 32 and 8, the file took 30.6 to 34.5 s
 * wall at loads of 36 to 45 on 24 CPUs; the row asks for under 30 s.
 */
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1).concat([60]);
const BACKLOG_SEEDS = Array.from({ length: 6 }, (_, i) => i + 1);
/** Row 011-221: sequences with the slow lane beside and holds. */
const SLOW_SEEDS = Array.from({ length: 8 }, (_, i) => i + 1);

interface Outcome {
  readonly name: string;
  readonly plan: Plan;
  readonly found: Violation[];
  readonly closed: ReadonlySet<Closed>;
}

async function playAll(): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = async (name: string, p: Plan) => {
    const { found, crossed, closed } = await play(p);
    out.push({ name, plan: p, found, closed });
    return crossed;
  };
  for (const [name, p] of Object.entries(DIRECTED)) await add(name, p);
  for (const seed of SEEDS) await add(`seed ${seed}`, plan(seed));
  for (const seed of BACKLOG_SEEDS) await add(`backlog seed ${seed}`, backlogPlan(seed));
  for (const seed of SLOW_SEEDS) await add(`slow-lane seed ${seed}`, slowPlan(seed));
  for (const { name, base, ms } of SWEEPS) {
    const last = base.events.length - 1;
    for (let reads = 0; reads < 16; reads++) {
      const events = [
        ...base.events.slice(0, last),
        { e: "cross" as const, reads, ms },
        ...base.events.slice(last),
      ];
      if (!(await add(`${name}, a jump at reading ${reads}`, { ...base, events }))) break;
    }
  }
  return out;
}

let outcomes: Promise<Outcome[]> | null = null;

/** The sequences that broke `inv`, each with its first violation and a shorter sequence that shows it. */
async function broken(inv: string): Promise<string[]> {
  outcomes ??= playAll();
  const lines: string[] = [];
  for (const { name, plan: p, found } of await outcomes) {
    const v = found.find((x) => x.inv === inv);
    if (v !== undefined)
      lines.push(`${name}, event ${v.at}: ${v.detail}; shortest: ${await shortest(p, v)}`);
  }
  return lines;
}

/** How G's sequences closed a slow lane with no slow run's end: both, or G met no case of its own. */
async function closes(): Promise<Closed[]> {
  outcomes ??= playAll();
  return [...new Set((await outcomes).flatMap((o) => [...o.closed]))].sort();
}

describe("a model of the scheduler holds spec 011 C4 step 5 and C15 over seeded sequences (row 011-195)", {
  timeout: 240_000,
}, () => {
  it("A: past 30 s, a yield cuts a tier only for a promoted file that ranks before its unended files (seed 60, a jump at each reading)", async () => {
    expect(await broken("A")).toEqual([]);
  });

  it("B: a tier that stands named runs a file that ranks with or before every queued promoted file (R398)", async () => {
    expect(await broken("B")).toEqual([]);
  });

  it("C: a yield cuts a file once per key (seed 173)", async () => {
    expect(await broken("C")).toEqual([]);
  });

  it("D: a current pass stays so at its key but by its own crash; a running file reads pending (R427, a forced backlog)", async () => {
    expect(await broken("D")).toEqual([]);
  });

  it("E: released and idle, every file is current but a crashed one; the scheduler reports no error", async () => {
    expect([...(await broken("E")), ...(await broken("err"))]).toEqual([]);
  });

  it("F: a promotion lasts while a file of its open wait is queued or running (F's reproduction)", async () => {
    expect(await broken("F")).toEqual([]);
  });

  it("G: a slow lane's instance closes under a hold and 60 s after its last run, never under its run (row 011-211)", async () => {
    expect(await broken("G")).toEqual([]);
    expect(await closes()).toEqual(["bound", "hold"]);
  });
});
