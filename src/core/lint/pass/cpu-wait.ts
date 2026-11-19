import { SLOT_WAITER_FRESH_MS } from "../../slow/slot-files.js";
import type { EpochMs } from "../../types/common.js";
import type { LintCpuWait } from "../../types/lint-delivery.js";
import type { LintMetaRepo } from "../store/types.js";

/*
 * Row 017-33 (gh-238, spec 017 D7, D9): while the pool refuses a lint
 * part's background lease, the pass records the wait with the numbers the
 * pool read, so status can say `waiting for CPU (21 busy, limit 18)`. No
 * scheduling changes: the record only tells. It is written at the first
 * refusal and again at most every `CPU_WAIT_REFRESH_MS` while refusals go
 * on, and dropped at a grant. A record older than a waiter's freshness
 * (`SLOT_WAITER_FRESH_MS`, as the pool forgets a waiter that stops looking)
 * is a pass that stopped looking, and reads as no wait.
 */

/** How often a wait that goes on writes its record again, with the pool's latest reading. */
export const CPU_WAIT_REFRESH_MS = 10_000;

/** `meta` key of a tool's scope's wait for CPU: `{ since, at, busy, limit }`. */
export const cpuWaitKey = (scope: string) => `lint-cpu-wait:${scope}`;

interface CpuWaitRecord extends LintCpuWait {
  /** When the record was last written. */
  readonly at: EpochMs;
}

function readRecord(meta: LintMetaRepo, scope: string): CpuWaitRecord | null {
  const raw = meta.get(cpuWaitKey(scope));
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    const busy = r.busy;
    if (
      typeof r.since !== "number" ||
      typeof r.at !== "number" ||
      typeof r.limit !== "number" ||
      (busy !== null && typeof busy !== "number")
    )
      return null;
    return { since: r.since as EpochMs, at: r.at as EpochMs, busy, limit: r.limit };
  } catch {
    return null;
  }
}

/**
 * The pool refused the scope's part at `now`, its gate as read (`null`
 * when the pool gave none): the wait starts, or goes on with the latest
 * numbers once the refresh is due.
 */
export function refusedCpu(
  meta: LintMetaRepo,
  scope: string,
  gate: { readonly busy: number | null; readonly limit: number } | null,
  now: EpochMs,
): void {
  if (gate === null) return;
  const last = readRecord(meta, scope);
  const live = last !== null && now - last.at <= SLOT_WAITER_FRESH_MS && now >= last.at;
  if (live && now - last.at < CPU_WAIT_REFRESH_MS) return;
  const record: CpuWaitRecord = {
    since: live ? last.since : now,
    at: now,
    busy: gate.busy,
    limit: gate.limit,
  };
  meta.set(cpuWaitKey(scope), JSON.stringify(record));
}

/** The scope's part got its lease, or the pass runs ungranted: no wait. */
export function grantedCpu(meta: LintMetaRepo, scope: string): void {
  if (meta.get(cpuWaitKey(scope)) !== null) meta.delete(cpuWaitKey(scope));
}

/** The scope's wait for CPU as of `now`; `null` with none, or one its pass stopped renewing. */
export function readCpuWait(meta: LintMetaRepo, scope: string, now: EpochMs): LintCpuWait | null {
  const r = readRecord(meta, scope);
  if (r === null || now - r.at > SLOT_WAITER_FRESH_MS) return null;
  return { since: r.since, busy: r.busy, limit: r.limit };
}
