import type { CodeStore } from "../code/store/types.js";
import { isRecord } from "../fs/index.js";
import type { CodeCheckId, CodeFile, CodeKnownState, CodeMeasure } from "../types/code.js";
import {
  CODE_LISTED_MAX,
  type CodeDeltaEntry,
  type CodeNews,
  type CodeRecount,
  type CodeRegistration,
  type CodeTooBig,
} from "../types/code-delivery.js";
import type { Consumer, EpochMs, RevisionNumber, WorktreeId } from "../types/index.js";
import { codeKey, planCodeDelta, seedEntry } from "./code-delta.js";
import { type CodeSource, withCode } from "./code-source.js";

/*
 * Spec 015 D6, store-backed: the registration seeds the consumer's code view
 * by count, and each tool boundary tells what changed since. The told marks
 * live in the code store's `meta`, one key per consumer: when its view was
 * seeded, and the files too big to count it was told of. Wave 1 tells the
 * `complexity` measure only.
 */

const MEASURE: CodeMeasure = "complexity";

/*
 * The code store's `meta` keys. The main store's registry (task 001-254)
 * names the main store's rows only; these are another file's.
 */
const consumerKey = (kind: string, c: Consumer) =>
  `${kind}:${c.worktreeId}:${c.sessionId}:${c.agentId}`;

/** Code `meta` key of the time `consumer`'s view was last seeded whole. */
export const seededKey = (consumer: Consumer) => consumerKey("seeded", consumer);

/** Code `meta` key of the files too big to count `consumer` was told of (D6, once per session). */
export const tooBigToldKey = (consumer: Consumer) => consumerKey("tooBigTold", consumer);

/** Code `meta` key of the worktree's latest recount (`CodeRecount`), written by the daemon's pass. */
export const recountKey = (worktreeId: WorktreeId) => `recount:${worktreeId}`;

/** The JSON value at code `meta` `key`; `null` when it is missing or unreadable. */
function readJson(store: CodeStore, key: string): unknown {
  const raw = store.meta.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(store: CodeStore, key: string, value: unknown): void {
  store.meta.set(key, JSON.stringify(value));
}

const REASONS: readonly CodeRecount["reason"][] = ["first", "threshold", "include", "counter"];

/** The worktree's latest recount; `null` when none is recorded or it is unreadable. */
export function readRecount(store: CodeStore, worktreeId: WorktreeId): CodeRecount | null {
  const value = readJson(store, recountKey(worktreeId));
  if (!isRecord(value)) return null;
  const { revision, at, reason, threshold } = value;
  if (typeof revision !== "number" || typeof at !== "number" || typeof threshold !== "number") {
    return null;
  }
  const known = REASONS.find((r) => r === reason);
  return known === undefined ? null : { revision, at, reason: known, threshold };
}

/** A file over `complexity.maxFileBytes`, which the daemon's pass keeps uncounted (015-06). */
export function isTooBig(file: CodeFile): boolean {
  return (file as CodeFile & { readonly tooBig?: boolean }).tooBig === true;
}

/** The check's measure's last transition in the worktree; `null` when none is recorded. */
export function lastTransition(
  store: CodeStore,
  worktreeId: WorktreeId,
  check: CodeCheckId,
  measure: CodeMeasure = MEASURE,
) {
  return (
    store.transitions.history(worktreeId, check).findLast((t) => t.measure === measure) ?? null
  );
}

/** Seeds `consumer`'s view with every judged state, told by count (D6), and marks when. */
function seed(
  store: CodeStore,
  consumer: Consumer,
  states: readonly CodeKnownState[],
  at: EpochMs,
): void {
  store.views.clear(consumer);
  const judged = states.filter((s) => s.outcome === "pass" || s.outcome === "fail");
  store.views.writeMany(
    consumer,
    judged.map((s) => seedEntry(s, at)),
  );
  writeJson(store, seededKey(consumer), at);
}

const over = (states: readonly CodeKnownState[]) =>
  states.filter((s) => s.outcome === "fail").length;

/**
 * Spec 015 D6: the registration's complexity line, with the consumer's view
 * seeded by count, so no function over the threshold now is told one by
 * one. `undefined` while the policy is off or the store cannot be read.
 */
export function registerCode(
  source: CodeSource | undefined,
  consumer: Consumer,
  at: EpochMs,
): CodeRegistration | undefined {
  const { worktreeId } = consumer;
  const read = withCode(source, ({ store, complexity }) =>
    store.transaction((): CodeRegistration => {
      const states = store.states.list(worktreeId, { measure: MEASURE });
      seed(store, consumer, states, at);
      const total = store.files.list(worktreeId).filter((f) => !isTooBig(f)).length;
      const pending = store.files.uncounted(worktreeId).length;
      const counting = pending === 0 ? {} : { counting: { done: total - pending, total } };
      return { v: 1, threshold: complexity.threshold, over: over(states), ...counting };
    }),
  );
  if (read !== "missing") return read ?? undefined;
  // No daemon has made the store yet: its first count has not started.
  const threshold = source?.policy()?.threshold;
  return threshold === undefined
    ? undefined
    : { v: 1, threshold, over: 0, counting: { done: 0, total: 0 } };
}

/** The paths `consumer` was told are too big to count. */
function toldTooBig(store: CodeStore, consumer: Consumer): ReadonlySet<string> {
  const value = readJson(store, tooBigToldKey(consumer));
  return new Set(Array.isArray(value) ? value.filter((p) => typeof p === "string") : []);
}

/**
 * Spec 015 D6: the files too big to count that changed after `since`, the
 * consumer's registration, and that it was not told of; recorded as told.
 */
function newTooBig(
  store: CodeStore,
  consumer: Consumer,
  since: RevisionNumber | null,
  limit: number,
): CodeTooBig[] {
  if (since === null) return [];
  const told = toldTooBig(store, consumer);
  const files = store.files
    .list(consumer.worktreeId)
    .filter((f) => isTooBig(f) && f.revision > since && !told.has(f.path));
  if (files.length === 0) return [];
  writeJson(store, tooBigToldKey(consumer), [...told, ...files.map((f) => f.path)]);
  return files.map((f) => ({ path: f.path, size: f.size, limit }));
}

/** The first line of the check's function in the worktree's current count; `null` when none is stored. */
export function lineOf(
  store: CodeStore,
  worktreeId: WorktreeId,
  check: CodeCheckId,
): number | null {
  const [file] = store.files.list(worktreeId, [check.path]);
  if (file === undefined) return null;
  const count = store.counts.get(file.blob, file.language, file.counterVersion);
  const fn = count?.functions.find(
    (f) => f.qualifiedName === check.qualifiedName && f.occurrence === check.occurrence,
  );
  return fn?.range.startLine ?? null;
}

/**
 * Spec 015 D5, D6: what `consumer` is told of the code at a delivery, its
 * view written in the same code store transaction. A recount since its
 * view was seeded is one summary line and seeds it again by count. `since`
 * reads its registration revision (`registration`), `null` when none is
 * recorded; only while the policy is on. `null` when there is nothing to
 * tell, the policy is off or the store cannot be read.
 */
export function tellCode(
  source: CodeSource | undefined,
  consumer: Consumer,
  at: EpochMs,
  since: () => RevisionNumber | null,
): CodeNews | null {
  const { worktreeId } = consumer;
  const told = withCode(source, ({ store, complexity }) =>
    store.transaction((): CodeNews | null => {
      const seeded = readJson(store, seededKey(consumer));
      const seededAt = typeof seeded === "number" ? seeded : 0;
      const states = store.states.list(worktreeId, { measure: MEASURE });
      const tooBig = newTooBig(store, consumer, since(), complexity.maxFileBytes);
      const big = tooBig.length === 0 ? {} : { tooBig };
      const recount = readRecount(store, worktreeId);
      if (recount !== null && recount.at > seededAt) {
        seed(store, consumer, states, at);
        return { v: 1, entries: [], more: 0, recount: { ...recount, over: over(states) }, ...big };
      }
      const plan = planCodeDelta({
        view: store.views.list(consumer).filter((v) => v.measure === MEASURE),
        states,
        last: (check, measure) => lastTransition(store, worktreeId, check, measure),
        seededAt,
        toldAt: at,
      });
      const listed = plan.entries.slice(0, CODE_LISTED_MAX);
      // The changes past the limit are told as a number only.
      const full = new Set(listed.map(codeKey));
      store.views.removeMany(consumer, plan.removals);
      store.views.writeMany(
        consumer,
        plan.writes.map((w) => (full.has(codeKey(w)) ? w : { ...w, told: "count" })),
      );
      if (plan.entries.length === 0 && tooBig.length === 0) return null;
      const entries: CodeDeltaEntry[] = listed.map((e) => ({
        ...e,
        line: e.kind === "removed" ? null : lineOf(store, worktreeId, e.check),
      }));
      return { v: 1, entries, more: plan.entries.length - entries.length, ...big };
    }),
  );
  return told === "missing" ? null : told;
}
