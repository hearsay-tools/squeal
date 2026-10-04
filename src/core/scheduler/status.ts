import type { SchedulerStatus, Validity } from "../types/index.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";

/** `Scheduler.status()`: counts of the daemon's own work since it started; `null` before `start`. */
export function statusOf(ledger: Ledger | null, notes: readonly string[]): SchedulerStatus {
  const testFiles = counts();
  const checks = counts();
  let running = 0;
  for (const file of ledger?.files.values() ?? []) {
    const validity = classify(file);
    testFiles[validity]++;
    checks[validity] += file.checks.length;
    if (file.phase === "running") running++;
  }
  const c = ledger?.counters;
  const active = ledger?.checkpoints.active ?? null;
  return {
    revision: ledger?.revision.number ?? 0,
    testFiles,
    checks,
    queued: ledger?.queue.size ?? 0,
    running,
    runs: {
      started: c?.started ?? 0,
      completed: c?.completed ?? 0,
      crashed: c?.crashed ?? 0,
      timedOut: c?.timedOut ?? 0,
    },
    lookups: { hits: c?.hits ?? 0, misses: c?.misses ?? 0 },
    discarded: c?.discarded ?? 0,
    checkpoint:
      active === null
        ? null
        : { id: active.record.id, kind: active.record.kind, remaining: active.remaining },
    notes: [...notes],
  };
}

function counts(): Record<Validity, number> {
  return { current: 0, pending: 0, stale: 0, unknown: 0 };
}
