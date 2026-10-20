// THROWAWAY probe (task 011-23, `notes.md` "The overlap margin"). Not a test: copy it to
// `test/e2e/stored-keys-margin.test.ts` (outside the daemon's set) and run it with
// `npx vitest run test/e2e/stored-keys-margin.test.ts`, then delete the copy.
//
// How long after its `recordedAt` a stored result commits: a scheduler with a fake runner of
// CHECKS checks per file runs `run --all` over FILES files in backlog tiers of TIER, on a store
// first seeded with SEED result rows. The scheduler's store is wrapped: each top-level
// transaction notes the earliest `recordedAt` its `putMany` calls carry and, once it returns
// (after COMMIT), the gap from that time to now.
import { randomUUID } from "node:crypto";
import { loadavg } from "node:os";
import { expect, it } from "vitest";
import type { RunReport, Store, TestFileRef } from "../../src/core/types/index.js";
import { claimRepo, FakeRunner, side } from "../scheduler/claims-fixture.js";

const FILES = Number(process.env.PROBE_FILES ?? 600);
const TIER = Number(process.env.PROBE_TIER ?? 200);
const CHECKS = Number(process.env.PROBE_CHECKS ?? 20);
const SEED = Number(process.env.PROBE_SEED ?? 300_000);

/** `FakeRunner` with `CHECKS` passing checks per file. */
class WideRunner extends FakeRunner {
  override async run(files: readonly TestFileRef[]): Promise<RunReport> {
    const report = await super.run(files);
    const results = report.results.flatMap((r) =>
      Array.from({ length: CHECKS }, (_, i) => ({
        ...r,
        check: { ...r.check, fullName: `check ${i}` },
      })),
    );
    return { ...report, results };
  }
}

function seed(store: Store, rows: number): void {
  const batch = 5_000;
  for (let done = 0; done < rows; done += batch) {
    store.results.putMany(
      Array.from({ length: Math.min(batch, rows - done) }, (_, i) => ({
        check: { kind: "test", project: "", testPath: `seed/${(done + i) % 900}.test.ts`, fullName: `c${done + i}` },
        key: randomUUID(),
        outcome: "pass" as const,
        durationMs: 1,
        location: null,
        fingerprint: null,
        summary: null,
        errors: [],
        provenance: {
          worktreeId: "seed",
          revision: 1,
          commit: null,
          dirty: false,
          runId: "seed",
          recordedAt: Date.now() - 86_400_000,
        },
      })),
    );
  }
}

it("the gap from a result's recordedAt to its commit", { timeout: 600_000 }, async () => {
  const { main } = claimRepo(FILES);
  const gaps: { gapMs: number; rows: number }[] = [];
  let depth = 0;
  let earliest: number | null = null;
  let rows = 0;
  const wrap = (store: Store): Store => {
    seed(store, SEED);
    return new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return <T>(fn: () => T): T => {
            depth += 1;
            try {
              return target.transaction(fn);
            } finally {
              depth -= 1;
              if (depth === 0 && earliest !== null) {
                gaps.push({ gapMs: Date.now() - earliest, rows });
                earliest = null;
                rows = 0;
              }
            }
          };
        }
        if (prop !== "results") return Reflect.get(target, prop, receiver);
        return {
          ...target.results,
          putMany: (records: Parameters<Store["results"]["putMany"]>[0]) => {
            for (const r of records) earliest = Math.min(earliest ?? r.provenance.recordedAt, r.provenance.recordedAt);
            rows += records.length;
            target.results.putMany(records);
          },
        };
      },
    });
  };
  const a = side(main, {
    count: FILES,
    backlogTierSize: TIER,
    policy: { baseline: { onStart: "lookup-only" } },
    wrap,
  });
  Object.setPrototypeOf(a.runner, WideRunner.prototype);
  await a.scheduler.start();
  await a.scheduler.idle();
  const load = loadavg()[0];
  await a.scheduler.requestFullSuite();
  await a.scheduler.idle();
  const sorted = gaps.map((g) => g.gapMs).sort((x, y) => x - y);
  // The read's own cost, best of 5: the window holding the run's keys, and one holding none.
  const best = (fn: () => unknown) => {
    let ms = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      fn();
      ms = Math.min(ms, performance.now() - t);
    }
    return Number(ms.toFixed(3));
  };
  const window = a.store.results.keysSince(Date.now() - 120_000).length;
  const readMs = best(() => a.store.results.keysSince(Date.now() - 120_000));
  const emptyMs = best(() => a.store.results.keysSince(Date.now()));
  console.log(
    JSON.stringify({
      load: Number(load.toFixed(1)),
      loadAfter: Number(loadavg()[0].toFixed(1)),
      files: FILES,
      tier: TIER,
      checks: CHECKS,
      seed: SEED,
      records: gaps.length,
      rowsPerRecord: gaps.map((g) => g.rows),
      gapMs: { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) },
      read: { keys: window, ms: readMs, emptyMs },
      all: gaps.map((g) => g.gapMs),
    }),
  );
  expect(gaps.length).toBeGreaterThan(0);
});
