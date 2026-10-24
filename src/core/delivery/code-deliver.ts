import { awaitFirstCount, readCursor } from "../code/pass/cursor.js";
import { uncountableFiles } from "../code/pass/failed.js";
import type { CodeStore } from "../code/store/types.js";
import { isRecord } from "../fs/index.js";
import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeMeasure,
  CodeViewEntry,
} from "../types/code.js";
import {
  CODE_LISTED_MAX,
  type CodeDeltaEntry,
  type CodeNews,
  type CodeRecount,
  type CodeRegistration,
  type CodeTooBig,
} from "../types/code-delivery.js";
import type { Consumer, EpochMs, WorktreeId } from "../types/index.js";
import { coverageMeasures, evidenceOf, failingOf, isCoverage } from "./code-coverage.js";
import {
  type CodeBound,
  codeKey,
  isOwn,
  isStillFail,
  planCodeDelta,
  seedEntry,
} from "./code-delta.js";
import { type CodeSource, withCode } from "./code-source.js";
import { withToldOver } from "./code-told.js";

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

function forget(store: CodeStore, key: string): void {
  store.meta.delete(key);
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

/**
 * D6's `counting: N of M`: the included files counted (`done`) and to count
 * (`total`), files too big left out. A file the counter failed on at every
 * attempt is neither: it is `uncountable` (row 015-18), so counting ends
 * when only such files remain.
 */
export function countingOf(
  store: CodeStore,
  worktreeId: WorktreeId,
): { readonly done: number; readonly total: number; readonly uncountable: number } {
  const files = store.files.list(worktreeId).filter((f) => !isTooBig(f));
  const spent = uncountableFiles(store, worktreeId, files);
  const pending = store.files.uncounted(worktreeId).filter((f) => !spent.has(f.path)).length;
  const total = files.length - spent.size;
  return { done: total - pending, total, uncountable: spent.size };
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

/** Every function failing now in the worktree. */
const failingIn = (store: CodeStore, worktreeId: WorktreeId) =>
  store.states.list(worktreeId, { measure: MEASURE, outcome: "fail" });

/**
 * Seeds `consumer`'s view with every failing state, told by count (D6), and
 * marks when. A function with no entry reads `pass` (lessons round 1, P5).
 */
function seed(
  store: CodeStore,
  consumer: Consumer,
  failing: readonly CodeKnownState[],
  at: EpochMs,
): void {
  store.views.clear(consumer);
  // Spec 015 D9 (row 015-12): the failing `crap` and `uncovered` states too, while judged.
  const covered = failingOf(
    store,
    consumer.worktreeId,
    coverageMeasures(store, consumer.worktreeId),
  );
  store.views.writeMany(
    consumer,
    [...failing, ...covered].map((s) => seedEntry(s, at)),
  );
  writeJson(store, seededKey(consumer), at);
}

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
      const failing = failingIn(store, worktreeId);
      // 015-37: a recount newer than the registration's clock is in the count it gives.
      seed(store, consumer, failing, Math.max(at, readRecount(store, worktreeId)?.at ?? 0));
      const { done, total } = countingOf(store, worktreeId);
      // 015-35: a new worktree's store is the common dir's; until its first count ends, no state is
      // its count, and that count tells the consumer its number.
      const counted = readCursor(store.meta, worktreeId) !== null;
      if (!counted) awaitFirstCount(store.meta, worktreeId);
      const counting = counted && done === total ? {} : { counting: { done, total } };
      return { v: 1, threshold: complexity.threshold, over: failing.length, ...counting };
    }),
  );
  if (read !== "missing") return read ?? undefined;
  // No daemon has made the store yet: its first count has not started.
  const threshold = source?.policy()?.threshold;
  return threshold === undefined
    ? undefined
    : { v: 1, threshold, over: 0, counting: { done: 0, total: 0 } };
}

/**
 * Lessons round 1, P5: what the code store keeps of consumers that left.
 * The views and seed marks of `gone`, which just unregistered, go, and in
 * `worktrees` the views of every consumer not in `registered` (011 C7's
 * departed ones); views of ended sessions otherwise stay for good. The
 * files too big to count each was told of stay, so the session resumed is
 * not told them again (row 015-36). Nothing while the policy is off or the
 * store cannot be read.
 */
export function dropCode(
  source: CodeSource | undefined,
  gone: readonly Consumer[],
  { worktrees, registered }: { worktrees: readonly WorktreeId[]; registered: readonly Consumer[] },
): void {
  withCode(source, ({ store }) =>
    store.transaction(() => {
      for (const consumer of gone) forget(store, seededKey(consumer));
      store.views.retain(worktrees, registered);
    }),
  );
}

/** The paths `consumer` was told are too big to count. */
function toldTooBig(store: CodeStore, consumer: Consumer): ReadonlySet<string> {
  const value = readJson(store, tooBigToldKey(consumer));
  return new Set(Array.isArray(value) ? value.filter((p) => typeof p === "string") : []);
}

/**
 * Spec 015 D6: the files too big to count that changed in `since`'s
 * revisions, the consumer's own, and that it was not told of; recorded as told.
 * Row 015-36: a first count or a recount writes every files row at its
 * revision (`recount`), which is no edit.
 */
function newTooBig(
  store: CodeStore,
  consumer: Consumer,
  { since, recount }: { since: CodeBound | null; recount: CodeRecount | null },
  limit: number,
  write: boolean,
): CodeTooBig[] {
  if (since === null) return [];
  const told = toldTooBig(store, consumer);
  const files = store.files
    .list(consumer.worktreeId)
    .filter(
      (f) =>
        isTooBig(f) &&
        isOwn(since, f.revision) &&
        f.revision !== recount?.revision &&
        !told.has(f.path),
    );
  if (files.length === 0) return [];
  if (write) writeJson(store, tooBigToldKey(consumer), [...told, ...files.map((f) => f.path)]);
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
 * The states a delivery compares with `view`: every failing function's,
 * and those of the files the view names, so a function told failing that
 * passes now, or has gone, is seen. Any other passes and has no entry.
 */
function statesFor(
  store: CodeStore,
  worktreeId: WorktreeId,
  failing: readonly CodeKnownState[],
  view: readonly CodeViewEntry[],
  measures: readonly CodeMeasure[] = [MEASURE],
): readonly CodeKnownState[] {
  const known = new Set(failing.map(codeKey));
  const paths = [...new Set(view.filter((v) => !known.has(codeKey(v))).map((v) => v.check.path))];
  if (paths.length === 0) return failing;
  const others = store.states
    .list(worktreeId, { paths })
    .filter((s) => measures.includes(s.measure) && s.outcome !== "fail");
  return [...failing, ...others];
}

/** What one delivery tells, and whether it writes anything. */
interface CodeStep {
  readonly news: CodeNews | null;
  readonly writes: boolean;
}

/** The delivery's code part; with `write`, the view and told marks it changes are written. */
function codeStep(
  store: CodeStore,
  consumer: Consumer,
  { at, since, limit }: { at: EpochMs; since: CodeBound | null; limit: number },
  write: boolean,
): CodeStep {
  const { worktreeId } = consumer;
  const seeded = readJson(store, seededKey(consumer));
  const seededAt = typeof seeded === "number" ? seeded : 0;
  const failing = failingIn(store, worktreeId);
  const recount = readRecount(store, worktreeId);
  const tooBig = newTooBig(store, consumer, { since, recount }, limit, write);
  const big = tooBig.length === 0 ? {} : { tooBig };
  if (recount !== null && recount.at > seededAt) {
    // 015-37: a hook reads its clock before this transaction, so a recount may be newer than
    // it; seeded at the recount's time at least, the next hook finds the summary told.
    if (write) seed(store, consumer, failing, Math.max(at, recount.at));
    const news: CodeNews = {
      v: 1,
      entries: [],
      more: 0,
      recount: { ...recount, over: failing.length },
    };
    return { news: { ...news, ...big }, writes: true };
  }
  // Spec 015 D9 (row 015-12): `crap` and `uncovered` beside complexity, while the daemon judges them.
  const covered = coverageMeasures(store, worktreeId);
  const measures: readonly CodeMeasure[] = [MEASURE, ...covered];
  const edits = new Map(store.states.edits(worktreeId, MEASURE).map((e) => [codeKey(e), e]));
  const view = store.views.list(consumer).filter((v) => measures.includes(v.measure));
  const judged = [...failing, ...failingOf(store, worktreeId, covered)];
  const plan = planCodeDelta({
    view,
    states: statesFor(store, worktreeId, judged, view, measures),
    last: (check, measure) => lastTransition(store, worktreeId, check, measure),
    edit: (check, measure) => edits.get(codeKey({ check, measure })) ?? null,
    seededAt,
    seenUpTo: since,
    toldAt: at,
  });
  const listed = plan.entries.slice(0, CODE_LISTED_MAX);
  // An edit past the limit is not counted, since `squeal code --changed` would not list it:
  // its entry stays told by count, so the function's next edit tells it.
  const more = plan.entries.slice(CODE_LISTED_MAX).filter((e) => !isStillFail(e.kind)).length;
  if (write) {
    // The changes past the limit are told as a number only.
    const full = new Set(listed.map(codeKey));
    store.views.removeMany(consumer, plan.removals);
    store.views.writeMany(
      consumer,
      plan.writes.map((w) => (full.has(codeKey(w)) ? w : { ...w, told: "count" })),
    );
  }
  const writes = plan.removals.length + plan.writes.length + tooBig.length > 0;
  if (plan.entries.length === 0 && tooBig.length === 0) return { news: null, writes };
  const entries: CodeDeltaEntry[] = listed.map((e) => ({
    ...e,
    line: e.kind === "removed" ? null : lineOf(store, worktreeId, e.check),
    ...evidenceOf(store, worktreeId, e),
  }));
  const coverage = plan.entries.some(isCoverage) ? { coverage: true as const } : {};
  return { news: { v: 1, entries, more, ...big, ...coverage }, writes };
}

/** What a delivery asks of the code. */
export interface TellCodeOptions {
  /** Tell the changes since the view, and write it (a tool boundary). Default `true`. */
  readonly changes?: boolean;
  /** Row 015-27: count the functions told over, for a delivery with test entries. Default `false`. */
  readonly toldOver?: boolean;
}

/**
 * Spec 015 D5, D6: what `consumer` is told of the code at a delivery, its
 * view written in the same code store transaction. A recount since its
 * view was seeded is one summary line and seeds it again by count. `since`
 * reads the revisions its changes are its own in (`codeSeenUpTo`), `null`
 * when no registration is recorded; only while the policy is on. A change
 * outside them is taken in by count. Read-only first, so a delivery
 * with nothing to write takes no lock the daemon's pass waits for. With
 * `toldOver`, the count is read after the view is written, so a FAIL this
 * delivery tells is in it. `null` when there is nothing to tell, the policy
 * is off or the store cannot be read; with neither option nothing is opened.
 */
export function tellCode(
  source: CodeSource | undefined,
  consumer: Consumer,
  at: EpochMs,
  since: () => CodeBound | null,
  { changes = true, toldOver = false }: TellCodeOptions = {},
): CodeNews | null {
  if (!changes && !toldOver) return null;
  const told = withCode(source, ({ store, complexity }) => {
    const over = (news: CodeNews | null) =>
      toldOver ? withToldOver(store, consumer, news, complexity.threshold) : news;
    if (changes) {
      const input = { at, since: since(), limit: complexity.maxFileBytes };
      if (store.read(() => codeStep(store, consumer, input, false)).writes) {
        return store.transaction(() => over(codeStep(store, consumer, input, true).news));
      }
    }
    return toldOver ? store.read(() => over(null)) : null;
  });
  return told === "missing" ? null : told;
}
