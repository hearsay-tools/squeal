import type { CodeBound } from "../../delivery/code-delta.js";
import type { Consumer, EpochMs, RelativePath } from "../../types/index.js";
import type { LintCheckId, LintKnownState, LintViewEntry } from "../../types/lint.js";
import {
  LINT_LISTED_MAX,
  type LintNews,
  type LintNewsEntry,
  type LintReasons,
  type LintRegistration,
  type LintSummary,
} from "../../types/lint-delivery.js";
import { readKeying } from "../pass/records.js";
import type { LintStore } from "../store/types.js";
import { candidatesOf, fromId, type LintPlan, planLintNews } from "./news.js";
import { countsOf, findingsOf, progressOf, reasonsOf } from "./snapshot.js";
import { type LintStoreSource, readOrNull, withLint } from "./source.js";
import { forgetTold, type LintToldMark, NO_MARK, readTold, sameMark, writeTold } from "./told.js";

/*
 * Spec 017 D8, after 015's `code-deliver.ts`: the registration seeds the
 * consumer's lint view by count, and each delivery tells what changed since,
 * read and acknowledged in the lint store. A first or config keying is one
 * summary once its files are linted, and the view is seeded again by count.
 */

/** What a read leaves to acknowledge: the view and mark as the read saw them. */
export interface LintAck {
  /** The view is seeded again whole: a summary was told. */
  readonly reseed: boolean;
  readonly writes: readonly LintViewEntry[];
  readonly removals: readonly LintCheckId[];
  readonly mark: LintToldMark;
}

/** A read's news, `null` when none, and what to acknowledge, `null` when nothing changes. */
export interface LintNewsRead {
  readonly news: LintNews | null;
  readonly ack: LintAck | null;
}

/** The view entries of every file whose last judged result fails, told by count. */
function seedEntries(states: readonly LintKnownState[], at: EpochMs): LintViewEntry[] {
  return states.flatMap((s) =>
    s.judged?.outcome === "fail"
      ? [
          {
            check: s.check,
            outcome: "fail" as const,
            fingerprint: s.judged.fingerprint,
            told: "count" as const,
            toldAt: at,
          },
        ]
      : [],
  );
}

/**
 * The last keying the consumer may count as told when it is seeded now: a
 * keying whose files still lint is not, so its summary comes once they are.
 */
function keyingSeen(store: LintStore, consumer: Consumer, states: readonly LintKnownState[]) {
  const seq = readKeying(store.meta, consumer.worktreeId)?.seq ?? 0;
  const linting = progressOf(store, consumer.worktreeId, states) !== undefined;
  return Math.max(0, seq - (linting ? 1 : 0));
}

/** The summary due to `mark`: a keying it has not seen whose files are linted. */
function summaryOf(
  store: LintStore,
  consumer: Consumer,
  mark: LintToldMark,
  states: () => readonly LintKnownState[],
): { readonly summary: LintSummary; readonly seq: number } | null {
  const keying = readKeying(store.meta, consumer.worktreeId);
  if (keying === null || keying.seq <= mark.keying) return null;
  const all = states();
  if (progressOf(store, consumer.worktreeId, all) !== undefined) return null;
  const { failing, stale } = countsOf(all);
  return {
    summary: { reason: keying.mode, revision: keying.revision, failing, stale },
    seq: keying.seq,
  };
}

/** One delivery's lint part, read only: what it tells and what acknowledging writes. */
function lintStep(
  store: LintStore,
  consumer: Consumer,
  at: EpochMs,
  seenUpTo: CodeBound | null,
): LintNewsRead {
  const { worktreeId } = consumer;
  const mark = readTold(store.meta, consumer) ?? NO_MARK;
  const lastId = store.transitions.lastId(worktreeId);
  const transitions = store.transitions.after(worktreeId, fromId(mark));
  const paths = candidatesOf(mark, transitions);
  const listed = (filter: { paths?: readonly RelativePath[] }) =>
    store.states.list(worktreeId, filter);
  const states = new Map(
    (paths.length === 0 ? [] : listed({ paths })).map((s) => [s.check.path, s]),
  );
  const view = new Map(store.views.list(consumer).map((v) => [v.check.path, v]));
  const plan = planLintNews({
    view,
    states,
    transitions,
    mark,
    seenUpTo,
    findings: (s) => findingsOf(store, s),
    at,
  });
  let all: readonly LintKnownState[] | null = null;
  const due = summaryOf(store, consumer, mark, () => (all ??= listed({})));
  const told = plan.entries.slice(0, LINT_LISTED_MAX);
  const reasons = reasonsOf(store, worktreeId);
  const next: LintToldMark = {
    transition: lastId,
    keying: due?.seq ?? mark.keying,
    deferred: due === null ? plan.deferred : [],
    failed: reasons.failed ?? null,
    off: reasons.off ?? null,
  };
  const writes = writesOf(plan, told, due === null ? null : (all ?? []), at);
  const changed = due !== null || writes.length + plan.removals.length > 0 || !sameMark(mark, next);
  return {
    news: newsOf(plan, told, due?.summary ?? null, reasons, mark),
    ack: changed
      ? { reseed: due !== null, writes, removals: due === null ? plan.removals : [], mark: next }
      : null,
  };
}

/**
 * The view entries a delivery writes: the plan's, those past the cap told
 * by count (015 D6); with a summary (`reseed`, every state), the view seeded
 * again by count with the changes it lists told in full.
 */
function writesOf(
  plan: LintPlan,
  told: readonly LintNewsEntry[],
  reseed: readonly LintKnownState[] | null,
  at: EpochMs,
): LintViewEntry[] {
  const full = new Set(told.map((e) => e.path));
  if (reseed === null) {
    return plan.writes.map((w) => (full.has(w.check.path) ? w : { ...w, told: "count" as const }));
  }
  return [
    ...seedEntries(reseed, at).filter((w) => !full.has(w.check.path)),
    ...plan.writes.filter((w) => full.has(w.check.path)),
  ];
}

/** The delivery's lint news; D9's reasons only when they are new to the consumer. `null` when none. */
function newsOf(
  plan: LintPlan,
  told: readonly LintNewsEntry[],
  summary: LintSummary | null,
  reasons: LintReasons,
  mark: LintToldMark,
): LintNews | null {
  const failed = reasons.failed !== undefined && reasons.failed !== mark.failed;
  const off = reasons.off !== undefined && reasons.off !== mark.off;
  if (plan.entries.length === 0 && summary === null && !failed && !off) return null;
  return {
    v: 1,
    entries: told,
    more: plan.entries.length - told.length,
    ...(summary === null ? {} : { summary }),
    ...(failed ? { failed: reasons.failed } : {}),
    ...(off ? { off: reasons.off } : {}),
  };
}

/** Writes what a read saw. A mark a later read already moved past is not moved back. */
function apply(store: LintStore, consumer: Consumer, ack: LintAck): void {
  store.transaction(() => {
    if (ack.reseed) store.views.clear(consumer);
    store.views.removeMany(consumer, ack.removals);
    store.views.writeMany(consumer, ack.writes);
    const now = readTold(store.meta, consumer);
    writeTold(store.meta, consumer, {
      ...ack.mark,
      transition: Math.max(ack.mark.transition, now?.transition ?? 0),
      keying: Math.max(ack.mark.keying, now?.keying ?? 0),
    });
  });
}

/**
 * Spec 017 D8: the registration's lint line, with the consumer's view
 * seeded by count, so no file failing now is told one by one. `undefined`
 * while the policy is off or the store cannot be read in time.
 */
export function registerLint(
  source: LintStoreSource | undefined,
  consumer: Consumer,
  at: EpochMs,
): LintRegistration | undefined {
  const { worktreeId } = consumer;
  const read = withLint(source, ({ store }) =>
    store.transaction((): LintRegistration => {
      const states = store.states.list(worktreeId);
      store.views.clear(consumer);
      store.views.writeMany(consumer, seedEntries(states, at));
      const reasons = reasonsOf(store, worktreeId);
      writeTold(store.meta, consumer, {
        transition: store.transitions.lastId(worktreeId),
        keying: keyingSeen(store, consumer, states),
        deferred: [],
        failed: reasons.failed ?? null,
        off: reasons.off ?? null,
      });
      const { failing, stale } = countsOf(states);
      const linting = progressOf(store, worktreeId, states);
      return { v: 1, failing, stale, ...(linting === undefined ? {} : { linting }), ...reasons };
    }),
  );
  if ("read" in read) return read.read;
  // No daemon has made the store yet: its first keying has not started.
  if (read.closed === "missing")
    return { v: 1, failing: 0, stale: 0, linting: { done: 0, total: 0 } };
  if (read.closed === "unreadable") return { v: 1, failing: 0, stale: 0, unreadable: read.reason };
  return undefined;
}

/**
 * Spec 017 D8: what `consumer` would be told of lint now, read only, and
 * what `acknowledgeLint` writes once the caller presented it. A change the
 * pass records after this read is past the mark the acknowledgement writes,
 * so the next read tells it. `null` while the policy is off or the store
 * cannot be read.
 */
export function readLintNews(
  source: LintStoreSource | undefined,
  consumer: Consumer,
  at: EpochMs,
  since: () => CodeBound | null,
): LintNewsRead | null {
  return readOrNull(
    withLint(source, ({ store }) => store.read(() => lintStep(store, consumer, at, since()))),
  );
}

/** Writes what a `readLintNews` saw: the consumer was told it. */
export function acknowledgeLint(
  source: LintStoreSource | undefined,
  consumer: Consumer,
  ack: LintAck,
): void {
  withLint(source, ({ store }) => apply(store, consumer, ack));
}

/**
 * Spec 017 D8, as `tellCode`: what `consumer` is told of lint at a
 * delivery, its view written in the same lint store transaction. Read only
 * first, so a delivery with nothing to write takes no lock the pass waits
 * for. `since` reads the revisions its changes are its own in
 * (`codeSeenUpTo`). `null` when there is nothing to tell, the policy is
 * off or the store cannot be read.
 */
export function tellLint(
  source: LintStoreSource | undefined,
  consumer: Consumer,
  at: EpochMs,
  since: () => CodeBound | null,
): LintNews | null {
  const told = withLint(source, ({ store }) => {
    const seen = since();
    const probe = store.read(() => lintStep(store, consumer, at, seen));
    if (probe.ack === null) return probe.news;
    return store.transaction(() => {
      const step = lintStep(store, consumer, at, seen);
      if (step.ack !== null) apply(store, consumer, step.ack);
      return step.news;
    });
  });
  return readOrNull(told);
}

/**
 * Lessons round 1, P5, as `dropCode`: the views and marks of `gone`, which
 * just unregistered. Nothing while the policy is off or the store cannot be
 * read.
 */
export function dropLint(source: LintStoreSource | undefined, gone: readonly Consumer[]): void {
  withLint(source, ({ store }) =>
    store.transaction(() => {
      for (const consumer of gone) {
        store.views.clear(consumer);
        forgetTold(store.meta, consumer);
      }
    }),
  );
}
