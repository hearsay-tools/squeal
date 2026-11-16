import { META_FULL_CHECK } from "../store/open.js";
import type { EpochMs } from "../types/common.js";
import type { LeaseProcess } from "../types/daemon-writes.js";
import type { Store } from "../types/store.js";
import { leaseProcess, leaseProcessAlive } from "./lease-process.js";

/**
 * Spec 011, store failures as amended 2026-10-25 (row 011-226): a daemon
 * start runs `quick_check`; the full `integrity_check` runs after a daemon
 * serves, at most once per store in this period.
 */
export const FULL_CHECK_EVERY_MS = 24 * 60 * 60_000;

/**
 * Row 011-375: `meta` key of the process that holds the full check's claim
 * while its check runs. Value: JSON `{ at, process }`, `at` the claim's
 * start in `META_FULL_CHECK` and `process` a `LeaseProcess`.
 */
export const META_FULL_CHECK_HOLDER = "store.full-check.holder";

/** The claim a daemon took: the start it wrote and the row's value before it. */
export interface Claim {
  readonly at: EpochMs;
  readonly before: string | null;
}

/** The holder row's value, or `null` when it is missing or unreadable. */
function holderOf(store: Store): { readonly at: number; readonly process: LeaseProcess } | null {
  const raw = store.meta.get(META_FULL_CHECK_HOLDER);
  if (raw === null) return null;
  try {
    const read = JSON.parse(raw) as { at?: unknown; process?: Partial<LeaseProcess> };
    const process = read.process;
    if (typeof read.at !== "number" || typeof process?.pid !== "number") return null;
    return {
      at: read.at,
      process: {
        pid: process.pid,
        startTime: typeof process.startTime === "number" ? process.startTime : null,
        pidNamespace: typeof process.pidNamespace === "string" ? process.pidNamespace : null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Row 011-375: whether the claim recorded as `before` was left by a process
 * that is surely gone (`leaseProcessAlive` false), its check unanswered. A
 * claim with no holder row (answered, or taken by a daemon before this row)
 * and a holder whose life cannot be told stay held.
 */
function orphaned(store: Store, before: string | null): boolean {
  if (before === null) return false;
  const holder = holderOf(store);
  return (
    holder !== null && String(holder.at) === before && leaseProcessAlive(holder.process) === false
  );
}

/**
 * Takes the full check's claim in a write transaction: when no full check
 * started in the last `FULL_CHECK_EVERY_MS`, or the one that did was left
 * unanswered by a process now gone (row 011-375), writes `at` as the last
 * one's start and `holder` as the process holding it. A start recorded after
 * `at` (a clock set back) is no claim held. A claim taken over gives back
 * no start: `before` is `null`.
 */
export function claimFullCheck(
  store: Store,
  at: EpochMs,
  holder: LeaseProcess = leaseProcess(),
): Claim | null {
  return store.transaction(() => {
    const before = store.meta.get(META_FULL_CHECK);
    const last = before === null ? Number.NaN : Number(before);
    const takenOver = orphaned(store, before);
    if (last <= at && at - last < FULL_CHECK_EVERY_MS && !takenOver) return null;
    store.meta.set(META_FULL_CHECK, String(at));
    store.meta.set(META_FULL_CHECK_HOLDER, JSON.stringify({ at, process: holder }));
    return { at, before: takenOver ? null : before };
  });
}

/** Deletes the holder row while it names `claim`. Call inside a transaction. */
function dropHolder(store: Store, claim: Claim): void {
  if (holderOf(store)?.at === claim.at) store.meta.delete(META_FULL_CHECK_HOLDER);
}

/** Gives a claim back while the row still holds it, so the next daemon's start runs the check. */
export function releaseClaim(store: Store, claim: Claim): void {
  store.transaction(() => {
    if (store.meta.get(META_FULL_CHECK) !== String(claim.at)) return;
    dropHolder(store, claim);
    if (claim.before === null) store.meta.delete(META_FULL_CHECK);
    else store.meta.set(META_FULL_CHECK, claim.before);
  });
}

/** Keeps an answered claim: its holder row goes, so no later daemon takes it over. */
export function keepClaim(store: Store, claim: Claim): void {
  store.transaction(() => dropHolder(store, claim));
}
