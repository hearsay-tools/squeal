/*
 * Throwaway probe for row 005-96: the cost the record adds to the transaction
 * that starts an edit tier, apart from the scheduler's other work. A private
 * store; each iteration runs one `BEGIN IMMEDIATE` with a stand-in start write
 * (one `meta` row), alternately without and with `recordEditTier` in it, with
 * 1, 12 and 100 projects in the record's width map (one tier of 4 files).
 * Each case prints one JSON line.
 */
import { cpus, loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { it } from "vitest";
import type { SchedulerContext } from "../../../../../../src/core/scheduler/context.js";
import { recordEditTier } from "../../../../../../src/core/scheduler/edit-timings.js";
import type { Tier } from "../../../../../../src/core/scheduler/tiers.js";
import { declareTraits } from "../../../../../../src/core/types/runner-traits.js";
import { freshStore, WT } from "../../../../../../test/state/helpers.js";

const ITERATIONS = Number(process.env.PROBE_ITERATIONS ?? 300);

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { medianMs: round(at(0.5)), p95Ms: round(at(0.95)), maxMs: round(sorted.at(-1) ?? 0) };
}

for (const projects of [1, 12, 100]) {
  it(`the record's cost with ${projects} projects`, () => {
    const store = freshStore();
    const context = {
      store,
      worktreeId: WT,
      now: () => 0,
      policy: { runner: { tierSize: 4 } },
      runner: { traits: declareTraits({ tierWidth: () => 4, tierPart: (r) => `vitest:${r.project}` }) },
    } as unknown as SchedulerContext;
    // Fill the width map with every project first.
    const tierOf = (i: number, revision: number, ps: number[]): Tier =>
      ({
        runId: `run-${i}`,
        kind: "edit",
        revision: { number: revision, head: null, dirty: true },
        files: ps.map((p, f) => ({
          file: { ref: { project: `p${p}`, path: `t/${f}.test.ts` }, durationMs: 100 },
        })),
        startedAt: i + 10,
      }) as unknown as Tier;
    const revision = store.revisions.append({
      worktreeId: WT,
      createdAt: 0,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash: null, newHash: "h" }],
    }).number;
    for (let p = 0; p < projects; p++) recordEditTier(context, tierOf(-1 - p, revision, [p]), 4);
    const without: number[] = [];
    const withRecord: number[] = [];
    const loadBefore = loadavg()[0];
    for (let i = 0; i < ITERATIONS; i++) {
      const ps = [0, 1, 2, 3].map((f) => (i * 4 + f) % projects);
      for (const record of [false, true]) {
        const t0 = performance.now();
        store.transaction(() => {
          store.meta.set("probe:start", String(i));
          if (record) recordEditTier(context, tierOf(i, revision, ps), 4);
        });
        (record ? withRecord : without).push(performance.now() - t0);
      }
    }
    console.log(
      JSON.stringify({
        probe: "005-96 record cost",
        projects,
        iterations: ITERATIONS,
        cpus: cpus().length,
        loadBefore,
        loadAfter: loadavg()[0],
        transactionWithout: stats(without),
        transactionWith: stats(withRecord),
        added: stats(withRecord.map((ms, i) => ms - (without[i] ?? 0))),
      }),
    );
  });
}
