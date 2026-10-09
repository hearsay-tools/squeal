import type { EpochMs, FlakyNote, ResultRecord, Store } from "../types/index.js";
import { checkIdentity } from "./derive.js";

/*
 * Spec 001 D6 as amended (task 001-170): a check whose stored outcome flips
 * under one key, a `fail` replaced by a `pass` or the reverse, carries a
 * flaky note, which `squeal why` and the report line show. The store keeps
 * one result per check and key, so the flip is seen only as a run's result
 * replaces the row.
 */

/** `meta` key of the flaky notes of every worktree: the rows they flip are shared. */
export const FLAKY_META_KEY = "flaky-checks";

/** The newest checks whose flaky note is kept; an older one is forgotten. */
export const FLAKY_KEPT = 1_024;

/** The flaky note of each check by `checkIdentity`, oldest first; empty when none parses. */
export function readFlakyNotes(store: Store): ReadonlyMap<string, FlakyNote> {
  const raw = store.meta.get(FLAKY_META_KEY);
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter((entry): entry is [string, FlakyNote] => isNote(entry[1])),
    );
  } catch {
    return new Map();
  }
}

/**
 * Records a flaky note for each check of `next` whose result replaces one of
 * `prior` under the same key with the other of `pass` and `fail`, and
 * returns those notes. `prior` is what the key held before `next` was stored.
 */
export function recordFlips(
  store: Store,
  prior: readonly ResultRecord[],
  next: readonly ResultRecord[],
  at: EpochMs,
): FlakyNote[] {
  const before = new Map(prior.map((r) => [`${checkIdentity(r.check)}\0${r.key}`, r]));
  const flips: [string, FlakyNote][] = [];
  for (const r of next) {
    const replaced = before.get(`${checkIdentity(r.check)}\0${r.key}`);
    if (replaced === undefined || !flipped(replaced.outcome, r.outcome)) continue;
    flips.push([
      checkIdentity(r.check),
      {
        key: r.key,
        from: replaced.outcome as FlakyNote["from"],
        to: r.outcome as FlakyNote["to"],
        fromWorktreeId: replaced.provenance.worktreeId,
        toWorktreeId: r.provenance.worktreeId,
        at,
      },
    ]);
  }
  if (flips.length === 0) return [];
  const kept = new Map(readFlakyNotes(store));
  for (const [id, note] of flips) {
    kept.delete(id);
    kept.set(id, note);
  }
  const newest = [...kept].slice(-FLAKY_KEPT);
  store.meta.set(FLAKY_META_KEY, JSON.stringify(Object.fromEntries(newest)));
  return flips.map(([, note]) => note);
}

function flipped(from: ResultRecord["outcome"], to: ResultRecord["outcome"]): boolean {
  return (from === "fail" && to === "pass") || (from === "pass" && to === "fail");
}

const OUTCOMES: ReadonlySet<unknown> = new Set(["pass", "fail"]);

function isNote(value: unknown): value is FlakyNote {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    OUTCOMES.has(v.from) &&
    OUTCOMES.has(v.to) &&
    typeof v.fromWorktreeId === "string" &&
    typeof v.toWorktreeId === "string" &&
    typeof v.at === "number"
  );
}

/** "FAIL -> PASS under the same inputs": a flaky note as a report line names it. */
export function flakyText(note: FlakyNote): string {
  return `flaky: ${note.from.toUpperCase()} -> ${note.to.toUpperCase()} under the same inputs`;
}
