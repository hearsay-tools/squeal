// Throwaway (row 005-104). A randomized model check: runs the real `planDelta`, `restrictPlan` and
// `transitionKind` (src/core/delivery/delta.ts, src/core/state/transitions.ts) over random sequences
// of state writes, retirements, registrations, deliveries and peeks, once with today's full view
// copy and once per candidate design. It reports per design how many runs deliver other entries than the copy (the shortest such run, and
// each kind of difference by check: the copy's entry -> the design's), and how many end a delivery
// holding another view. No store, no I/O.
// Usage: node_modules/.bin/tsx sim.ts [runs] [seed]
import { planDelta, restrictPlan } from "../../../../../../src/core/delivery/delta.js";
import { checkIdentity } from "../../../../../../src/core/state/derive.js";
import { transitionKind } from "../../../../../../src/core/state/transitions.js";
import type { CheckId } from "../../../../../../src/core/types/check.js";
import type { DeltaEntry, ViewEntry } from "../../../../../../src/core/types/delivery.js";
import type { KnownOutcome, KnownState, Transition } from "../../../../../../src/core/types/state.js";

const RUNS = Number(process.argv[2] ?? 200_000);
let seed = Number(process.argv[3] ?? 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

const WT = "wt";
const CHECKS: CheckId[] = ["a", "b", "c"].map((n) => ({
  kind: "test",
  project: "",
  testPath: "t.test.ts",
  fullName: n,
}));
const CONSUMERS = ["c1", "c2"] as const;
type C = (typeof CONSUMERS)[number];
const REGRESSIONS = new Set(["pass-to-fail", "first-seen-fail", "fail-changed"]);

interface S {
  outcome: KnownOutcome;
  fingerprint: string | null;
  own: boolean; // an unknown whose only cause is the consumer's own edit (001-220)
}
const known = (k: CheckId, s: S): KnownState => ({
  worktreeId: WT,
  check: k,
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
type Row = { outcome: KnownOutcome; fingerprint: string | null };

/** One design: how it registers, what it reads as the view, and what a write to states does. */
interface Design {
  readonly name: string;
  register(c: C, w: World): void;
  /** The view planDelta reads: stored rows plus what the design reads for a check with no row. */
  view(c: C, w: World): Map<string, Row>;
  /** Called before a state of `id` is written or deleted (a trigger's place). */
  beforeWrite?(id: string, w: World): void;
  rows: Map<C, Map<string, Row>>;
}

interface World {
  states: Map<string, S>;
  log: { id: string; t: Transition }[];
  seq: number; // the store's write sequence
  changed: Map<string, number>; // per check: seq of its last write (any field)
  born: Map<string, number>; // per check: seq of the insert that created the row (AUTOINCREMENT)
  mark: Map<C, number>; // per consumer: seq at registration
  pos: Map<C, number>; // per consumer: transitions log length at registration
}

const nonPass = (w: World) =>
  new Map([...w.states].filter(([, s]) => s.outcome !== "pass").map(([id, s]) => [id, row(s)]));
const row = (s: S): Row => ({ outcome: s.outcome, fingerprint: s.fingerprint });

function design(
  name: string,
  seed: (w: World) => Map<string, Row>,
  implicit: (c: C, id: string, s: S, w: World) => Row | null,
  extra: Partial<Design> = {},
): Design {
  const rows = new Map<C, Map<string, Row>>();
  return {
    name,
    rows,
    register: (c, w) => void rows.set(c, seed(w)),
    view: (c, w) => {
      const v = new Map(rows.get(c));
      for (const [id, s] of w.states) {
        if (v.has(id)) continue;
        const r = implicit(c, id, s, w);
        if (r !== null) v.set(id, r);
      }
      return v;
    },
    ...extra,
  };
}

/** Before of a check with no row, read from the notable log after the registration position. */
const fromLog = (c: C, id: string, s: S, w: World): Row | null => {
  const after = w.log.slice(w.pos.get(c) ?? 0).find((e) => e.id === id);
  if (after === undefined) return row(s);
  return after.t.from === null ? null : { outcome: after.t.from, fingerprint: after.t.fromFingerprint };
};
const bySeq = (c: C, id: string, s: S, w: World): Row | null =>
  (w.changed.get(id) ?? Infinity) <= (w.mark.get(c) ?? -1) ? row(s) : null;
const byBirth = (c: C, id: string, _s: S, w: World): Row | null =>
  (w.born.get(id) ?? Infinity) <= (w.mark.get(c) ?? -1) ? { outcome: "pass", fingerprint: null } : null;

function makeDesigns(): Design[] {
  const lazy = design("seq + copy-on-write", () => new Map(), bySeq);
  lazy.beforeWrite = (id, w) => {
    const old = w.states.get(id);
    if (old === undefined) return;
    for (const c of CONSUMERS) {
      const r = lazy.rows.get(c);
      if (r === undefined || r.has(id)) continue;
      if ((w.changed.get(id) ?? Infinity) <= (w.mark.get(c) ?? -1)) r.set(id, row(old));
    }
  };
  return [
    design("copy (today)", (w) => new Map([...w.states].map(([id, s]) => [id, row(s)])), () => null),
    design("log position", () => new Map(), fromLog),
    design("log position + non-pass seed", nonPass, fromLog),
    design("seq watermark", () => new Map(), bySeq),
    design("seq watermark + non-pass seed", nonPass, bySeq),
    lazy,
    design("non-pass seed + birth mark", nonPass, byBirth),
    // The upgrade's risk: a release before the change delivers to a consumer this design registered.
    design("non-pass seed, delivered by an earlier release (no birth mark read)", nonPass, () => null),
  ];
}

const short = (e: DeltaEntry) => `${(e.check as { fullName: string }).fullName}:${e.kind}:${e.from}->${e.to}`;
const viewText = (v: Map<string, Row>, w: World) =>
  [...v]
    .filter(([id]) => w.states.has(id) || v.get(id)?.outcome === "fail")
    .map(([id, r]) => `${id.split("\0")[3]}=${r.outcome}${r.fingerprint ?? ""}`)
    .sort()
    .join(",");

function run(): Record<string, { trace: string[]; at: string } | null> {
  const w: World = { states: new Map(), log: [], seq: 0, changed: new Map(), born: new Map(), mark: new Map(), pos: new Map() };
  const designs = makeDesigns();
  const firstBreak: Record<string, { trace: string[]; at: string } | null> = {};
  for (const d of designs) firstBreak[d.name] = null;
  const trace: string[] = [];
  const registered = new Set<C>();
  const history = (k: CheckId) => w.log.filter((e) => e.id === checkIdentity(k)).map((e) => e.t);
  const write = (id: string, next: S | null) => {
    for (const d of designs) d.beforeWrite?.(id, w);
    w.seq++;
    if (next === null) {
      w.states.delete(id);
      w.changed.delete(id);
      w.born.delete(id);
      return;
    }
    if (!w.states.has(id)) w.born.set(id, w.seq);
    w.states.set(id, next);
    w.changed.set(id, w.seq);
  };
  for (let step = 0; step < 24; step++) {
    const r = rand();
    const k = pick(CHECKS);
    const id = checkIdentity(k);
    const c = pick(CONSUMERS);
    if (r < 0.4) {
      const outcome = pick<KnownOutcome>(["pass", "pass", "fail", "skip", "unknown"]);
      const next: S = {
        outcome,
        fingerprint: outcome === "fail" ? pick(["f1", "f2"]) : null,
        own: outcome === "unknown" && rand() < 0.5,
      };
      const before = w.states.get(id);
      const same = before?.outcome === next.outcome && before.fingerprint === next.fingerprint && before.own === next.own;
      if (same) continue;
      const kind = transitionKind(before === undefined ? null : row(before), next);
      if (kind !== null)
        w.log.push({
          id,
          t: {
            worktreeId: WT, check: k, kind, from: before?.outcome ?? null, to: next.outcome,
            fromFingerprint: before?.fingerprint ?? null, toFingerprint: next.fingerprint, revision: 1, at: 1,
          },
        });
      write(id, next);
      trace.push(`set ${k.kind === "test" ? k.fullName : ""}=${next.outcome}${next.fingerprint ?? ""}${next.own ? "(own)" : ""}`);
    } else if (r < 0.5) {
      if (!w.states.has(id)) continue;
      write(id, { ...(w.states.get(id) as S) }); // a rewrite: validity or duration only
      trace.push(`rewrite ${(k as { fullName: string }).fullName}`);
    } else if (r < 0.57) {
      if (!w.states.has(id)) continue;
      write(id, null);
      // sink.retire: told non-failures leave every view silently
      for (const d of designs)
        for (const rows of d.rows.values()) if (rows.get(id) !== undefined && rows.get(id)?.outcome !== "fail") rows.delete(id);
      trace.push(`retire ${(k as { fullName: string }).fullName}`);
    } else if (r < 0.66) {
      registered.add(c);
      w.mark.set(c, w.seq);
      w.pos.set(c, w.log.length);
      for (const d of designs) d.register(c, w);
      trace.push(`register ${c}`);
    } else {
      if (!registered.has(c)) continue;
      const peek = r > 0.9;
      trace.push(`${peek ? "peek" : "deliver"} ${c}`);
      const states = [...w.states].map(([sid, s]) => known(CHECKS.find((x) => checkIdentity(x) === sid) as CheckId, s));
      let reference = "";
      let referenceView = "";
      for (const d of designs) {
        const view = d.view(c, w);
        const entries: ViewEntry[] = [...view].map(([vid, v]) => ({
          check: CHECKS.find((x) => checkIdentity(x) === vid) as CheckId,
          outcome: v.outcome,
          fingerprint: v.fingerprint,
          toldAt: 0,
        }));
        const full = planDelta({
          view: entries, states, isBaselineFinding: () => false, toldAt: 1, rootOf: () => null, revision: 1,
          history, ownEdit: (s) => s.outcome === "unknown" && s.summary === "own",
        });
        const plan = peek ? restrictPlan(full, (e) => REGRESSIONS.has(e.kind)) : full;
        const said = plan.entries.map(short).join(" ");
        const rows = d.rows.get(c) as Map<string, Row>;
        for (const rm of plan.removals) rows.delete(checkIdentity(rm));
        for (const wr of plan.writes) rows.set(checkIdentity(wr.check), { outcome: wr.outcome, fingerprint: wr.fingerprint });
        const after = viewText(d.view(c, w), w);
        if (d === designs[0]) {
          reference = said;
          referenceView = after;
          trace.push(`  told: ${said || "(nothing)"}`);
        } else {
          if (after !== referenceView) viewDiffs.add(d.name);
          if (said !== reference) {
            const byCheck = (t: string) => new Map(t.split(" ").filter(Boolean).map((e) => [e.split(":")[0], e.split(":").slice(1).join(":")]));
            const a = byCheck(reference), b = byCheck(said);
            for (const ch of new Set([...a.keys(), ...b.keys()]))
              if (a.get(ch) !== b.get(ch)) {
                const sig = `${d.name}|${a.get(ch) ?? "nothing"} -> ${b.get(ch) ?? "nothing"}`;
                kinds.set(sig, (kinds.get(sig) ?? 0) + 1);
              }
          }
          if (firstBreak[d.name] === null && said !== reference)
            firstBreak[d.name] = { trace: [...trace], at: `told "${said || "(nothing)"}" where the copy told "${reference || "(nothing)"}"` };
        }
      }
    }
  }
  return firstBreak;
}

const breaks = new Map<string, number>();
const viewRuns = new Map<string, number>();
let viewDiffs = new Set<string>();
const kinds = new Map<string, number>();
const shortest = new Map<string, { trace: string[]; at: string }>();
for (let i = 0; i < RUNS; i++) {
  viewDiffs = new Set();
  const result = run();
  for (const name of viewDiffs) viewRuns.set(name, (viewRuns.get(name) ?? 0) + 1);
  for (const [name, b] of Object.entries(result)) {
    if (!breaks.has(name)) breaks.set(name, 0);
    if (b === null) continue;
    breaks.set(name, (breaks.get(name) ?? 0) + 1);
    const prev = shortest.get(name);
    if (prev === undefined || b.trace.length < prev.trace.length) shortest.set(name, b);
  }
}
console.log(`${RUNS} random runs of 24 steps, 3 checks, 2 consumers`);
for (const [name, n] of breaks) {
  if (name === "copy (today)") continue;
  console.log(`\n${name}: tells other entries than the copy in ${n} runs; holds another view in ${viewRuns.get(name) ?? 0}`);
  const s = shortest.get(name);
  if (s !== undefined) console.log(`  shortest: ${s.trace.join("; ")}\n  -> ${s.at}`);
  for (const [sig, count] of [...kinds].filter(([k]) => k.startsWith(`${name}|`)).sort((x, y) => y[1] - x[1]))
    console.log(`  ${count} deliveries: copy ${sig.split("|")[1]}`);
}
