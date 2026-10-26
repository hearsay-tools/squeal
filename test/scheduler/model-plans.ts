import { COMMAND_HOLD_MAX_MS } from "../../src/core/scheduler/command-hold.js";

/*
 * The seeded sequences of row 011-195's model of the scheduler
 * (`model-fixture.ts`), with row 011-221's slow-lane plan: the events, the
 * test files and the plans that order them.
 */

export type Ev =
  | { e: "edit"; path: string }
  | { e: "promote"; files: string[]; ms: number }
  | { e: "end"; slot: number; file: number }
  | { e: "finish"; slot: number; crash: boolean }
  | { e: "step"; ms: number }
  | { e: "cross"; reads: number; ms: number }
  | { e: "runAll"; force: boolean }
  /** A command hold begins, bounded by `ms`, as `squeal hold --max` writes it. */
  | { e: "hold"; ms: number }
  /** Every hold the model began ends, as its command's exit does. */
  | { e: "unhold" };

export const SLOWS = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
export const P = "f/p.test.ts";
export const Q = "test/q.test.ts";
export const ALL = [...SLOWS, P, Q];
/** Row 011-221: the slow lane's files of a plan with `slowLane`, through `src/x.ts`. */
export const E2E = ["e2e/x1.test.ts", "e2e/x2.test.ts"];

export interface Plan {
  readonly seed: number;
  /** `vitest` cancels and reports each file's end; `node` does neither, runs its backlog in slots and may crash. */
  readonly kind: "vitest" | "node";
  /** The last-known duration of each slow file. */
  readonly slowMs: number;
  /** Row 011-221: `E2E` in the slow lane, beside the files of `ALL`. */
  readonly slowLane?: boolean;
  readonly events: readonly Ev[];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

/** The probe's sequences: seed n here is its seed n under `KIND=mixed`, or `kind`'s. */
export function plan(seed: number, len = 12, kind?: Plan["kind"]): Plan {
  const r = rng(seed);
  const k = kind ?? (r() < 0.7 ? "vitest" : "node");
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [];
  while (events.length < len) {
    const x = r();
    if (x < 0.08) events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts"]) });
    else if (x < 0.33) {
      const files = new Set<string>();
      for (const n = r() < 0.6 ? 1 : 2; files.size < n; ) files.add(pick(r, ALL));
      events.push({
        e: "promote",
        files: [...files],
        ms: pick(r, [3_000, 30_000, 60_000, 120_000]),
      });
    } else if (x < 0.5)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.58) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.4 });
    else if (x < 0.85)
      events.push({ e: "step", ms: pick(r, [1_000, 5_000, 20_000, 35_000, 60_000]) });
    else if (x < 0.94)
      events.push({ e: "cross", reads: 1 + Math.floor(r() * 4), ms: pick(r, [30_000, 60_000]) });
    else events.push({ e: "runAll", force: r() < 0.5 });
  }
  return { seed, kind: k, slowMs, events };
}

/**
 * A rarer order (recommendation 3): the start's runs end, `run --all
 * --force` queues a forced backlog, then edits and crashes come beside it.
 */
export function backlogPlan(seed: number, len = 10): Plan {
  const r = rng(seed ^ 0x9e3779b9);
  const kind = r() < 0.6 ? "node" : "vitest";
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [
    { e: "finish", slot: 0, crash: false },
    { e: "finish", slot: 0, crash: false },
    { e: "runAll", force: true },
    { e: "step", ms: 1_000 },
  ];
  while (events.length < len) {
    const x = r();
    if (x < 0.3) events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts"]) });
    else if (x < 0.55) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.5 });
    else if (x < 0.7)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.85) events.push({ e: "step", ms: pick(r, [1_000, 20_000, 35_000]) });
    else if (x < 0.95)
      events.push({ e: "promote", files: [pick(r, ALL)], ms: pick(r, [3_000, 60_000]) });
    else events.push({ e: "runAll", force: r() < 0.5 });
  }
  return { seed, kind, slowMs, events };
}

/**
 * Row 011-221: the slow lane beside. Edits reach its files through
 * `src/x.ts`, steps pass row 011-211's 60 s bound while fast work runs, and
 * holds begin and end around its runs.
 */
export function slowPlan(seed: number, len = 12): Plan {
  const r = rng(seed ^ 0x85ebca6b);
  const kind = r() < 0.6 ? "vitest" : "node";
  const slowMs = pick(r, [20_000, 35_000, 200_000]);
  const events: Ev[] = [];
  while (events.length < len) {
    const x = r();
    if (x < 0.18)
      events.push({ e: "edit", path: pick(r, ["src/s.ts", "src/p.ts", "src/q.ts", "src/x.ts"]) });
    else if (x < 0.26)
      events.push({ e: "promote", files: [pick(r, ALL)], ms: pick(r, [30_000, 120_000]) });
    else if (x < 0.42)
      events.push({ e: "end", slot: Math.floor(r() * 4), file: Math.floor(r() * 6) });
    else if (x < 0.56) events.push({ e: "finish", slot: Math.floor(r() * 4), crash: r() < 0.3 });
    else if (x < 0.8) events.push({ e: "step", ms: pick(r, [5_000, 30_000, 60_000]) });
    else if (x < 0.91)
      events.push({ e: "hold", ms: pick(r, [20_000, 90_000, COMMAND_HOLD_MAX_MS]) });
    else events.push({ e: "unhold" });
  }
  return { seed, kind, slowMs, slowLane: true, events };
}
