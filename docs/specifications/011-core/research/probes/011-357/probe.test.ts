/*
 * Throwaway probe for row 011-357 (`research/scheduler-step.md`, decision 4).
 * Not part of the product suite. It measures how long each lock turn of the
 * scheduler lasts while slow lanes run, with 1, 3 and 6 configured groups:
 * the catch-up fake runner (runs end at once), a private store and slot
 * directory, a scratch HOME (`vitest.config.ts`), the load guard read at 0.
 * Each round edits the one source every file imports and waits until every
 * file is current. Each case prints one JSON line.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it, onTestFinished } from "vitest";
import type { CheckGroup } from "../../../../../../src/core/types/check-groups.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import {
  type CatchUpFile,
  catchUpRepo,
  catchUpSide,
} from "../../../../../../test/scheduler/catch-up-fixture.js";

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 30);
const FAST = 4;
const PER_GROUP = 2;

function files(groups: number): CatchUpFile[] {
  const fast = Array.from({ length: FAST }, (_, i) => ({
    path: `test/fast${i}.test.ts`,
    ms: 10,
    imports: ["src/core.ts"],
  }));
  const grouped = Array.from({ length: groups }, (_, g) =>
    Array.from({ length: PER_GROUP }, (_, i) => ({
      path: `test/g${g}/f${i}.test.ts`,
      ms: 20,
      imports: ["src/core.ts"],
    })),
  ).flat();
  return [...fast, ...grouped];
}

function group(g: number): CheckGroup {
  return {
    name: `g${g}`,
    runner: "vitest",
    tests: [`test/g${g}/**`],
    at: "edit",
    limits: { maxParallel: 2, deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 5_000 } },
  };
}

interface Stats {
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    count: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
    totalMs: round(sorted.reduce((a, b) => a + b, 0)),
  };
}

/**
 * The operation with the group's name and numbers taken out, so the groups
 * and revisions pool; a step's turn also names what it decided (`onStep`).
 */
const kindOf = (operation: string | null, decided: readonly string[]) => {
  const kind = (operation ?? "(none)").replace(/group g\d+/, "group <g>").replace(/\d+/g, "<n>");
  const tags = [...new Set(decided)].sort().join(",");
  return tags === "" ? kind : `${kind} [${tags}]`;
};

for (const groups of [1, 3, 6]) {
  it(`lock turns with ${groups} configured groups`, async () => {
    const all = files(groups);
    const repo = catchUpRepo(all);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-357-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const side = catchUpSide(repo, repo.main, {
      files: all,
      hostSlots: 8,
      policy: {
        ...RUN_MISSING,
        slow: { ...DEFAULT_POLICY.slow, quietMs: 0 },
        checks: Array.from({ length: groups }, (_, g) => group(g)),
      },
      scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
    });
    await side.scheduler.start();
    const current = () => all.every((f) => side.current(f.path));
    await expect.poll(current, { timeout: 60_000 }).toBe(true);
    await side.scheduler.idle();

    // Each part of a turn under one text (a relabel starts a part), and each whole turn.
    const turns = new Map<string, number[]>();
    const wholes = new Map<string, number[]>();
    const add = (map: Map<string, number[]>, kind: string, ms: number) =>
      map.set(kind, [...(map.get(kind) ?? []), ms]);
    let open: { operation: string | null; at: number; decided: string[] } | null = null;
    let whole: { operation: string | null; at: number; decided: string[]; lane: boolean } | null =
      null;
    const stop = side.scheduler.watchLock?.((holder) => {
      const now = performance.now();
      if (open !== null) add(turns, kindOf(open.operation, open.decided), now - open.at);
      if (holder === null && whole !== null) {
        const kind = `${kindOf(whole.operation, whole.decided)}${whole.lane ? " +lane" : ""}`;
        add(wholes, kind, now - whole.at);
        whole = null;
      } else if (holder !== null && whole === null) {
        whole = { operation: holder.operation, at: now, decided: [], lane: false };
      } else if (holder !== null && whole !== null && holder.operation !== whole.operation) {
        // A relabel inside the step's turn (row 011-357): a lane decided in it.
        whole.lane = true;
      }
      open = holder === null ? null : { operation: holder.operation, at: now, decided: [] };
    });
    // A step tells its decisions inside its lock turn: they tag the turn open now.
    const unstep = side.scheduler.onStep?.((seen) => {
      const tags = seen.decisions.filter((kind) => kind !== "read-install" && kind !== "read-probe");
      if (seen.inTurn) tags.push("in-turn");
      open?.decided.push(...tags);
      whole?.decided.push(...tags);
    });
    const loadBefore = loadavg()[0];
    const started = performance.now();
    for (let round = 0; round < ROUNDS; round++) {
      const runs = side.runner.runs.length;
      await side.edit("watch", "src/core.ts");
      await expect
        .poll(() => side.runner.runs.length - runs >= FAST / 4 + groups && current(), {
          timeout: 60_000,
          interval: 5,
        })
        .toBe(true);
      await side.scheduler.idle();
    }
    const wallMs = performance.now() - started;
    stop?.();
    unstep?.();
    const loadAfter = loadavg()[0];
    const table = (map: Map<string, number[]>) =>
      Object.fromEntries(
        [...map].sort(([a], [b]) => a.localeCompare(b)).map(([kind, ms]) => [kind, stats(ms)]),
      );
    const byKind = table(turns);
    const byTurn = table(wholes);
    const turnMs = [...wholes.values()].flat();
    console.log(
      JSON.stringify({
        probe: "011-357 lock turns",
        groups,
        rounds: ROUNDS,
        cpus: (await import("node:os")).cpus().length,
        loadBefore,
        loadAfter,
        wallMs: Math.round(wallMs),
        lockTotalMs: stats(turnMs).totalMs,
        longestTurnMs: stats(turnMs).maxMs,
        byTurn,
        byKind,
      }),
    );
  });
}
