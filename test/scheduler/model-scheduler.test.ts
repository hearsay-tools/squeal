import { describe, expect, it } from "vitest";
import { ALL, backlogPlan, type Ev, type Flight, Model, type Plan, plan } from "./model-fixture.js";

/*
 * Row 011-195 (016-18, `research/model-scheduler.md` recommendations 1, 3
 * and 4): six invariants of spec 011 C4 step 5 and C15 Rank and Lifetime,
 * checked over the seeded sequences of `model-fixture.ts`, rare orders and
 * the sequences of the defects the model found. Each sequence is played
 * once with every invariant checked; each group's case reads its own.
 */

interface Violation {
  readonly inv: string;
  /** The event it was seen after, from 1. */
  readonly at: number;
  readonly detail: string;
}

/** Invariants A to F of one sequence, read from the daemon's store and rows and the runner's calls. */
class Checks {
  readonly found: Violation[] = [];
  /** The event being played, from 1, and the model's clock at its start. */
  at = 0;
  eventAt: number;
  readonly #vitest: boolean;
  readonly #cuts = new Map<string, number>();
  readonly #waits: { files: string[]; deadline: number; open: boolean }[] = [];
  /** The key each file was a current pass at. */
  readonly #was = new Map<string, string>();

  constructor(
    readonly m: Model,
    kind: Plan["kind"],
  ) {
    this.#vitest = kind === "vitest";
    this.eventAt = m.clock.raw();
    m.onCut = (f, reason) => this.#cut(f, reason);
  }

  #add(inv: string, detail: string): void {
    this.found.push({ inv, at: this.at, detail });
  }

  /** C15 Rank: a file an open wait selected ranks by that wait's request, read from the daemon's row. */
  #rank(path: string, t: number): number {
    const i = this.m.promotions().findIndex((x) => x.until > t && x.paths.includes(path));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  }

  #listed(path: string): boolean {
    return this.m.live().some((f) => f.files.some((x) => x.path === path));
  }

  /** The queued promoted files that rank before every one of `unended` at `t`. */
  #beats(unended: readonly string[], t: number): string[] {
    const { m } = this;
    const beat = Math.min(...unended.map((x) => this.#rank(x, t)));
    // In no run that has not ended it, and queued or not current: it could make a tier yield.
    const queued = (x: string) =>
      !m.running(x) && (m.rows().get(x)?.pending === "queued" || !m.current(x));
    return ALL.filter((x) => queued(x) && this.#rank(x, t) < beat);
  }

  promoted(files: string[], ms: number): void {
    const open = files.some((x) => this.#listed(x) || this.m.rows().get(x)?.pending === "queued");
    this.#waits.push({ files, deadline: this.eventAt + ms, open });
  }

  /** Inside the decision that cancels `f`. */
  #cut(f: Flight, reason: unknown): void {
    const { m } = this;
    // A cancel before row 011-56 names no cause: with no edit since the tier started, it is a yield.
    const yields = reason === "yield" || (typeof reason !== "string" && m.edits === f.edits);
    if (!yields || !this.#vitest) return;
    const t = m.clock.raw();
    const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
    // C: C4 step 5, a yield cuts a file once per key, the key its run started at.
    for (const path of unended) {
      const key = `${path}@${f.startKeys.get(path)}`;
      const n = (this.#cuts.get(key) ?? 0) + 1;
      this.#cuts.set(key, n);
      if (n > 1) this.#add("C", `${path} cut ${n} times at one key`);
    }
    // A: once a tier has run 30 s, a promoted file cuts it only when it ranks before every
    // unended file, judged at the cut and at the event's start (a jump may have come between).
    if (t - f.startedAt < 31_000 || m.edits !== f.edits) return;
    if ([t, this.eventAt].some((when) => this.#beats(unended, when).length > 0)) return;
    const s = Math.round((t - f.startedAt) / 1000);
    this.#add("A", `tier of ${unended.join(" ")} cut at ${s} s, no promoted file before it`);
  }

  /** At each quiet point. */
  steady(): void {
    for (const path of ALL) this.#validity(path);
    this.#lifetime();
    this.#named();
  }

  /** D: a current pass at key K is not `unknown` while K stays, unless a run at K crashed; a file running at its key reads pending. */
  #validity(path: string): void {
    const { m } = this;
    const row = m.rows().get(path);
    const key = row?.key ?? null;
    const told = this.#was.get(path);
    const crashed = m.flights.some((f) => f.crashed && f.startKeys.get(path) === key);
    if (told === key && m.unknown(path) && !crashed)
      this.#add("D", `${path} was current at its key and is now unknown`);
    if (key !== null && m.passes(path)) this.#was.set(path, key);
    else if (told !== key) this.#was.delete(path);
    const held = m
      .live()
      .some((f) => key !== null && f.startKeys.get(path) === key && !f.ended.has(path));
    if (held && row?.pending == null && !m.current(path))
      this.#add("D", `${path} runs at its key and its row is not pending`);
  }

  /** F: C15 Lifetime, a promotion lasts until its deadline or until none of its files is queued or running. */
  #lifetime(): void {
    const { m } = this;
    const t = m.clock.raw();
    for (const [n, w] of this.#waits.entries()) {
      if (!w.open || w.deadline <= t) continue;
      const live = w.files.filter((x) => this.#listed(x) || m.rows().get(x)?.pending === "queued");
      // None queued or running: the promotion ended, and a later edit that queues them does not bring it back.
      if (live.length === 0) w.open = false;
      else if (
        !m.promotions().some((x) => x.until > t && w.files.every((y) => x.paths.includes(y)))
      )
        this.#add(
          "F",
          `wait ${n} (${w.files.join(" ")}) is open, ${live.join(" ")} queued or running, its promotion gone`,
        );
    }
  }

  /** B: a tier that stands `named` runs a file that ranks with or before every queued promoted file. */
  #named(): void {
    const { m } = this;
    const live = m.live().filter((f) => !f.cancelled);
    const f = live[0];
    if (!this.#vitest || f === undefined || live.length > 1 || m.edits !== f.edits) return;
    if (m.standings().filter((k) => k === "named").length !== 1) return;
    const unended = f.files.filter((x) => !f.ended.has(x.path)).map((x) => x.path);
    const better = this.#beats(unended, m.clock.raw());
    if (better.length > 0)
      this.#add(
        "B",
        `tier stands named, but ${better.join(" ")} ranks before every unended file (${unended.join(" ")})`,
      );
  }

  /** E: released and idle, every file is current but one whose last run crashed at its key (C4). */
  async released(): Promise<void> {
    const { m } = this;
    if (!(await m.drain())) return this.#add("E", "never idle after every run was released");
    const rows = m.rows();
    const crashedAt = (x: string) => {
      const last = m.flights.findLast((f) => f.files.some((y) => y.path === x));
      return last?.crashed === true && last.startKeys.get(x) === (rows.get(x)?.key ?? null);
    };
    const stale = ALL.filter((x) => !m.current(x) && !crashedAt(x));
    if (stale.length > 0) this.#add("E", `not current after release: ${stale.join(" ")}`);
  }
}

interface Played {
  readonly found: Violation[];
  /** Each `cross` moved the clock. */
  readonly crossed: boolean;
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
  return { found: checks.found, crossed };
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

/** The fixed seeds: the probe's mixed sequences, and as many from a forced backlog. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat([60, 141]);
const BACKLOG_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);

interface Outcome {
  readonly name: string;
  readonly plan: Plan;
  readonly found: Violation[];
}

async function playAll(): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const add = async (name: string, p: Plan) => {
    const { found, crossed } = await play(p);
    out.push({ name, plan: p, found });
    return crossed;
  };
  for (const [name, p] of Object.entries(DIRECTED)) await add(name, p);
  for (const seed of SEEDS) await add(`seed ${seed}`, plan(seed));
  for (const seed of BACKLOG_SEEDS) await add(`backlog seed ${seed}`, backlogPlan(seed));
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
});
