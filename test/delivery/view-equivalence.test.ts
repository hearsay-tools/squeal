import { describe, expect, it } from "vitest";
import { planDelta, restrictPlan, viewThroughMark } from "../../src/core/delivery/delta.js";
import { checkIdentity } from "../../src/core/state/derive.js";
import { transitionKind } from "../../src/core/state/transitions.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { DeltaEntry, ViewEntry } from "../../src/core/types/delivery.js";
import type { KnownOutcome, KnownState, Transition } from "../../src/core/types/state.js";

/*
 * Row 005-106: the model check of 005 `research/consumer-view-design.md` (its `sim.ts`) as a
 * test. Random sequences of state writes, rewrites, retirements, registrations, deliveries and
 * peeks for 3 checks and 2 consumers. Each delivery runs the real `planDelta` (and `restrictPlan`
 * for a peek) once per design, and applies its writes and removals to that design's rows:
 *
 * - the full copy (before this row), the reference;
 * - design N as built: the non-pass rows seeded, the birth mark read through `viewThroughMark`;
 * - an earlier release delivering to a consumer design N registered: the same rows, read as they
 *   are (section 4's mixed-version case), whose misses are pinned below.
 *
 * Birth marks follow `state_born`: a state's mark is the store's write count when its row was
 * inserted, kept by rewrites, gone with the row; a registration keeps the count.
 */

const RUNS = 10_000;
const STEPS = 24;
const SEED = 11;

const CHECKS: readonly CheckId[] = ["a", "b", "c"].map((fullName) => ({
  kind: "test",
  project: "",
  testPath: "t.test.ts",
  fullName,
}));
const CONSUMERS = ["c1", "c2"] as const;
type C = (typeof CONSUMERS)[number];
const REGRESSIONS = new Set(["pass-to-fail", "first-seen-fail", "fail-changed"]);
type Row = { readonly outcome: KnownOutcome; readonly fingerprint: string | null };
type S = Row & { readonly own: boolean };
type Design = "copy" | "N" | "earlier release";
const DESIGNS: readonly Design[] = ["copy", "N", "earlier release"];

interface World {
  states: Map<string, S>;
  log: { id: string; t: Transition }[];
  seq: number;
  born: Map<string, number>;
  mark: Map<C, number>;
  rows: Map<Design, Map<C, Map<string, Row>>>;
}

const checkOf = (id: string) => CHECKS.find((k) => checkIdentity(k) === id) as CheckId;
const row = (s: Row): Row => ({ outcome: s.outcome, fingerprint: s.fingerprint });
const nameOf = (check: CheckId) => (check as { fullName: string }).fullName;

const known = (id: string, s: S): KnownState => ({
  worktreeId: "wt",
  check: checkOf(id),
  outcome: s.outcome,
  validity: "current",
  pendingPhase: null,
  observedAt: 1,
  commit: null,
  origin: { kind: "own" },
  durationMs: null,
  location: null,
  summary: s.own ? "own" : null,
  fingerprint: s.fingerprint,
});

const entriesOf = (rows: Map<string, Row>): ViewEntry[] =>
  [...rows].map(([id, r]) => ({ check: checkOf(id), ...r, toldAt: 0 }));

/** What `planDelta` reads for `design`. */
function viewFor(design: Design, c: C, w: World, states: readonly KnownState[]): ViewEntry[] {
  const rows = entriesOf(w.rows.get(design)?.get(c) ?? new Map());
  if (design !== "N") return rows;
  const mark = w.mark.get(c) ?? -1;
  const bornBefore = (s: KnownState) => (w.born.get(checkIdentity(s.check)) ?? Infinity) <= mark;
  return [...viewThroughMark(rows, states, bornBefore, 0)];
}

/** A view as text; entries of retired checks that are not failures read nothing, so are left out. */
const viewText = (view: readonly ViewEntry[], w: World) =>
  view
    .filter((v) => w.states.has(checkIdentity(v.check)) || v.outcome === "fail")
    .map((v) => `${nameOf(v.check)}=${v.outcome}${v.fingerprint ?? ""}`)
    .sort()
    .join(",");

const said = (entries: readonly DeltaEntry[]) =>
  new Map(entries.map((e) => [nameOf(e.check), `${e.kind}:${e.from}->${e.to}`]));

interface Tally {
  runsDiffering: Record<Design, number>;
  viewsDiffering: Record<Design, number>;
  /** "<copy's entry> -> <design's>" per check, with the number of deliveries. */
  differences: Record<Design, Map<string, number>>;
  deliveries: number;
}

function newWorld(): World {
  return {
    states: new Map(),
    log: [],
    seq: 0,
    born: new Map(),
    mark: new Map(),
    rows: new Map(DESIGNS.map((d) => [d, new Map()])),
  };
}

/** Writes or deletes a state as its `INSERT OR REPLACE` or `DELETE` would, with its birth mark. */
function write(w: World, id: string, next: S | null): void {
  w.seq++;
  if (next === null) {
    w.states.delete(id);
    w.born.delete(id);
    return;
  }
  if (!w.states.has(id)) w.born.set(id, w.seq);
  w.states.set(id, next);
}

function logTransition(w: World, id: string, before: S | undefined, next: S): void {
  const kind = transitionKind(before === undefined ? null : row(before), next);
  if (kind === null) return;
  w.log.push({
    id,
    t: {
      worktreeId: "wt",
      check: checkOf(id),
      kind,
      from: before?.outcome ?? null,
      to: next.outcome,
      fromFingerprint: before?.fingerprint ?? null,
      toFingerprint: next.fingerprint,
      revision: 1,
      at: 1,
    },
  });
}

/** `sink.retire`: the state goes, and told non-failures leave every view silently. */
function retire(w: World, id: string): void {
  write(w, id, null);
  for (const byConsumer of w.rows.values()) {
    for (const rows of byConsumer.values()) {
      if (rows.has(id) && rows.get(id)?.outcome !== "fail") rows.delete(id);
    }
  }
}

function register(w: World, c: C): void {
  w.mark.set(c, w.seq);
  const all = new Map([...w.states].map(([id, s]) => [id, row(s)]));
  const nonPass = [...all].filter(([, s]) => s.outcome !== "pass");
  w.rows.get("copy")?.set(c, all);
  w.rows.get("N")?.set(c, new Map(nonPass));
  w.rows.get("earlier release")?.set(c, new Map(nonPass));
}

/** One delivery (a peek when `peek`) to `c` in every design, tallied against the copy. */
function deliver(w: World, c: C, peek: boolean, tally: Tally, run: Set<string>): void {
  const states = [...w.states].map(([id, s]) => known(id, s));
  const history = (k: CheckId) => w.log.filter((e) => e.id === checkIdentity(k)).map((e) => e.t);
  let reference = new Map<string, string>();
  let referenceView = "";
  for (const design of DESIGNS) {
    const full = planDelta({
      view: viewFor(design, c, w, states),
      states,
      isBaselineFinding: () => false,
      toldAt: 1,
      rootOf: () => null,
      revision: 1,
      history,
      ownEdit: (s) => s.outcome === "unknown" && s.summary === "own",
    });
    const plan = peek ? restrictPlan(full, (e) => REGRESSIONS.has(e.kind)) : full;
    const rows = w.rows.get(design)?.get(c) as Map<string, Row>;
    for (const removed of plan.removals) rows.delete(checkIdentity(removed));
    for (const written of plan.writes) rows.set(checkIdentity(written.check), row(written));
    const told = said(plan.entries);
    const after = viewText(viewFor(design, c, w, states), w);
    if (design === "copy") {
      reference = told;
      referenceView = after;
      continue;
    }
    if (after !== referenceView) run.add(`view:${design}`);
    for (const check of new Set([...reference.keys(), ...told.keys()])) {
      if (reference.get(check) === told.get(check)) continue;
      run.add(`told:${design}`);
      const key = `${reference.get(check) ?? "nothing"} -> ${told.get(check) ?? "nothing"}`;
      const counts = tally.differences[design];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}

function simulate(runs: number, seed: number): Tally {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const zero = () => ({ copy: 0, N: 0, "earlier release": 0 });
  const tally: Tally = {
    runsDiffering: zero(),
    viewsDiffering: zero(),
    differences: { copy: new Map(), N: new Map(), "earlier release": new Map() },
    deliveries: 0,
  };
  for (let i = 0; i < runs; i++) {
    const w = newWorld();
    const run = new Set<string>();
    for (let step = 0; step < STEPS; step++) {
      const r = rand();
      const id = checkIdentity(pick(CHECKS));
      const c = pick(CONSUMERS);
      const before = w.states.get(id);
      if (r < 0.4) {
        const outcome = pick<KnownOutcome>(["pass", "pass", "fail", "skip", "unknown"]);
        const fingerprint = outcome === "fail" ? pick(["f1", "f2"]) : null;
        const next: S = { outcome, fingerprint, own: outcome === "unknown" && rand() < 0.5 };
        const same =
          before?.outcome === next.outcome &&
          before.fingerprint === next.fingerprint &&
          before.own === next.own;
        if (same) continue;
        logTransition(w, id, before, next);
        write(w, id, next);
      } else if (r < 0.5) {
        if (before !== undefined) write(w, id, { ...before }); // validity or duration only
      } else if (r < 0.57) {
        if (before !== undefined) retire(w, id);
      } else if (r < 0.66) {
        register(w, c);
      } else if (w.rows.get("copy")?.has(c)) {
        tally.deliveries++;
        deliver(w, c, r > 0.9, tally, run);
      }
    }
    for (const design of DESIGNS) {
      if (run.has(`told:${design}`)) tally.runsDiffering[design]++;
      if (run.has(`view:${design}`)) tally.viewsDiffering[design]++;
    }
  }
  return tally;
}

describe("the view through birth marks against the full copy (row 005-106)", () => {
  const tally = simulate(RUNS, SEED);

  it("delivers often enough to mean something", () => {
    expect(tally.deliveries).toBeGreaterThan(RUNS * 2);
  });

  it("tells the same entries and holds the same view in every run", () => {
    expect([...tally.differences.N]).toEqual([]);
    expect(tally.runsDiffering.N).toBe(0);
    expect(tally.viewsDiffering.N).toBe(0);
  });

  /*
   * Section 4: an earlier release that delivers to a consumer this release registered reads a
   * pass with no entry as never told. On record, what it can miss: a PASS -> UNKNOWN goes
   * untold, and a PASS -> FAIL through a skip reads first observed (from the skip). Failures
   * are seeded, so it never repeats or loses one.
   */
  it("on record: an earlier release delivering to such a consumer misses only these", () => {
    expect(tally.runsDiffering["earlier release"]).toBeGreaterThan(0);
    expect([...tally.differences["earlier release"].keys()].sort()).toEqual([
      "pass-to-fail:pass->fail -> first-seen-fail:skip->fail",
      "to-unknown:pass->unknown -> nothing",
    ]);
  });
});
