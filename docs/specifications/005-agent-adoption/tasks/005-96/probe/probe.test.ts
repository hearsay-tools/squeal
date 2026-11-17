/*
 * Throwaway probe for row 005-96. Not part of the product suite. It measures
 * how long the scheduler's lock turns last when edit tiers start, with 1, 4
 * and 12 projects (the record's width map has one entry per project): the
 * catch-up fake runner (runs end at once), a private store, a scratch HOME
 * (`vitest.config.ts`). Each round edits the one source every file imports
 * and waits until every file is current. Each case prints one JSON line.
 * Adapted from `011-core/research/probes/011-357/probe.test.ts`.
 */
import { cpus, loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import {
  type CatchUpFile,
  catchUpRepo,
  catchUpSide,
} from "../../../../../../test/scheduler/catch-up-fixture.js";

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 30);
const PER_PROJECT = 2;

function files(projects: number): CatchUpFile[] {
  return Array.from({ length: projects }, (_, p) =>
    Array.from({ length: PER_PROJECT }, (_, i) => ({
      project: `p${p}`,
      path: `test/p${p}/f${i}.test.ts`,
      ms: 10,
      imports: ["src/core.ts"],
    })),
  ).flat();
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

/** The operation with its numbers taken out, and what the step decided in it (`onStep`). */
const kindOf = (operation: string | null, decided: readonly string[]) => {
  const kind = (operation ?? "(none)").replace(/\d+/g, "<n>");
  const tags = [...new Set(decided)].sort().join(",");
  return tags === "" ? kind : `${kind} [${tags}]`;
};

for (const projects of [1, 4, 12]) {
  it(`lock turns with ${projects} projects`, async () => {
    const all = files(projects);
    const repo = catchUpRepo(all);
    const side = catchUpSide(repo, repo.main, { files: all, hostSlots: 8, policy: RUN_MISSING });
    await side.scheduler.start();
    const current = () => all.every((f) => side.current(f.path));
    await expect.poll(current, { timeout: 60_000 }).toBe(true);
    await side.scheduler.rest();

    const turns = new Map<string, number[]>();
    let open: { operation: string | null; at: number; decided: string[] } | null = null;
    const stop = side.scheduler.watchLock?.((holder) => {
      const now = performance.now();
      if (open !== null && (holder === null || holder.operation !== open.operation)) {
        const kind = kindOf(open.operation, open.decided);
        turns.set(kind, [...(turns.get(kind) ?? []), now - open.at]);
        open = null;
      }
      if (holder !== null && open === null) {
        open = { operation: holder.operation, at: now, decided: [] };
      }
    });
    const unstep = side.scheduler.onStep?.((seen) => {
      const tags = seen.decisions.filter((kind) => kind !== "read-install" && kind !== "read-probe");
      open?.decided.push(...tags);
    });
    const loadBefore = loadavg()[0];
    const started = performance.now();
    for (let round = 0; round < ROUNDS; round++) {
      const runs = side.runner.runs.length;
      await side.edit("watch", "src/core.ts");
      await expect
        .poll(() => side.runner.runs.length > runs && current(), { timeout: 60_000, interval: 5 })
        .toBe(true);
      await side.scheduler.rest();
    }
    const wallMs = performance.now() - started;
    stop?.();
    unstep?.();
    const loadAfter = loadavg()[0];
    const all_ = [...turns.values()].flat();
    const starts = [...turns]
      .filter(([kind]) => kind.includes("start-tier"))
      .flatMap(([, ms]) => ms);
    console.log(
      JSON.stringify({
        probe: "005-96 lock turns",
        projects,
        rounds: ROUNDS,
        cpus: cpus().length,
        loadBefore,
        loadAfter,
        wallMs: Math.round(wallMs),
        lockTotalMs: stats(all_).totalMs,
        longestTurnMs: stats(all_).maxMs,
        startTierTurns: stats(starts),
        // The record's size after the run: absent before row 005-96.
        recordBytes: side.store.meta.get(`edit-timings:${side.worktreeId}`)?.length ?? null,
        byKind: Object.fromEntries(
          [...turns].sort(([a], [b]) => a.localeCompare(b)).map(([k, ms]) => [k, stats(ms)]),
        ),
      }),
    );
  });
}
