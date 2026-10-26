import { type CodeBound, isOwn } from "../../delivery/code-delta.js";
import type { CodeSince } from "../../delivery/code-since.js";
import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { LintKnownState } from "../../types/lint.js";
import type {
  LintChanged,
  LintChangedEntry,
  LintDetails,
  LintFileDetail,
  LintReasons,
  LintStatus,
  LintStopEvidence,
} from "../../types/lint-delivery.js";
import type { LintStore } from "../store/types.js";
import { countsOf, findingsOf, isCurrentFail, progressOf, reasonsOf } from "./snapshot.js";
import { type LintRead, type LintStoreSource, withLint } from "./source.js";

/*
 * Spec 017 D8: status, `squeal lint` and Stop's check, which read the lint
 * store with no consumer of their own; "since this session started" is
 * 015's `codeSince`. Each reads the store as the pass left it and needs no
 * daemon.
 */

/** What a surface says when the store was not read: none while off, else why. */
function closedAs<T>(
  read: LintRead<T>,
  empty: (reasons: LintReasons & object) => T,
): T | undefined {
  if ("read" in read) return read.read;
  if (read.closed === "missing") return empty({});
  if (read.closed === "unreadable") return empty({ unreadable: read.reason });
  return undefined;
}

const NOT_STARTED = { linting: { done: 0, total: 0 } } as const;

/**
 * D8 Blocking: the files failing at their current key whose last
 * transition into `fail` is in `since`'s revisions. A file failing before
 * them, or that went to `fail` by a config change, which records no
 * transition, is not among them.
 */
export function wentToFail(
  store: LintStore,
  worktreeId: WorktreeId,
  states: readonly LintKnownState[],
  since: CodeBound,
): { readonly state: LintKnownState; readonly revision: RevisionNumber }[] {
  return states.filter(isCurrentFail).flatMap((state) => {
    const into = store.transitions
      .history(worktreeId, state.check)
      .findLast((t) => t.kind === "first-seen-fail" || t.kind === "pass-to-fail");
    return into !== undefined && isOwn(since, into.revision)
      ? [{ state, revision: into.revision }]
      : [];
  });
}

/** Spec 017 D8 Status: `undefined` while the policy is off or the store cannot be read in time. */
export function lintStatus(
  source: LintStoreSource | undefined,
  worktreeId: WorktreeId,
  since: CodeSince | null,
): LintStatus | undefined {
  const scope = since?.scope ?? null;
  const read = withLint(source, ({ store }) =>
    store.read((): LintStatus => {
      const states = store.states.list(worktreeId);
      const linting = progressOf(store, worktreeId, states);
      const went = since === null ? [] : wentToFail(store, worktreeId, states, since);
      return {
        v: 1,
        ...countsOf(states),
        sinceRegistration: went.length,
        since: scope,
        ...(linting === undefined ? {} : { linting }),
        ...reasonsOf(store, worktreeId),
      };
    }),
  );
  return closedAs(read, (reasons) => ({
    v: 1,
    files: 0,
    failing: 0,
    sinceRegistration: 0,
    since: scope,
    pending: 0,
    stale: 0,
    unknown: 0,
    reasons: [],
    ...(reasons.unreadable === undefined ? NOT_STARTED : reasons),
  }));
}

function detailOf(store: LintStore, s: LintKnownState): LintFileDetail {
  return {
    path: s.check.path,
    outcome: s.outcome,
    stale: s.stale,
    findings: findingsOf(store, s),
    revision: s.judged?.revision ?? null,
    reason: s.reason,
  };
}

/**
 * Spec 017 D8 Details, `squeal lint [<path>...]`: with no path, every file
 * failing at its last judged result, stale ones marked, newest first; with
 * paths, each path's state in their order, and those with none apart.
 */
export function lintDetails(
  source: LintStoreSource | undefined,
  worktreeId: WorktreeId,
  paths?: readonly RelativePath[],
): LintDetails | undefined {
  const read = withLint(source, ({ store }) =>
    store.read((): LintDetails => {
      const states = store.states.list(worktreeId);
      const byPath = new Map(states.map((s) => [s.check.path, s]));
      const shown =
        paths === undefined
          ? states
              .filter((s) => s.outcome === "fail")
              .sort(
                (a, b) =>
                  (b.judged?.revision ?? 0) - (a.judged?.revision ?? 0) ||
                  a.check.path.localeCompare(b.check.path),
              )
          : paths.flatMap((p) => byPath.get(p) ?? []);
      const { pending, stale, unknown } = countsOf(states);
      const linting = progressOf(store, worktreeId, states);
      return {
        v: 1,
        files: shown.map((s) => detailOf(store, s)),
        notLinted: (paths ?? []).filter((p) => !byPath.has(p)),
        pending,
        stale,
        unknown,
        ...(linting === undefined ? {} : { linting }),
        ...reasonsOf(store, worktreeId),
      };
    }),
  );
  return closedAs(read, (reasons) => ({
    v: 1,
    files: [],
    notLinted: [...(paths ?? [])],
    pending: 0,
    stale: 0,
    unknown: 0,
    ...(reasons.unreadable === undefined ? NOT_STARTED : reasons),
  }));
}

/**
 * Spec 017 D8, `squeal lint --changed`: each file whose last transition is
 * in `since`'s revisions, the newest revision first and by path in one,
 * with its state now. It holds every
 * change a delivery told or counted in `more`, since a delivery tells a
 * file only when its last transition is the consumer's own.
 */
export function lintChanged(
  source: LintStoreSource | undefined,
  worktreeId: WorktreeId,
  since: CodeSince | null,
  paths?: readonly RelativePath[],
): LintChanged | undefined {
  const scope = since?.scope ?? null;
  const read = withLint(source, ({ store }) =>
    store.read((): LintChanged => {
      const asked = paths === undefined ? null : new Set(paths);
      const last =
        since === null
          ? []
          : store.transitions
              .latest(worktreeId)
              .filter((t) => isOwn(since, t.revision) && (asked?.has(t.check.path) ?? true));
      const states = new Map(
        (last.length === 0
          ? []
          : store.states.list(worktreeId, { paths: last.map((t) => t.check.path) })
        ).map((s) => [s.check.path, s]),
      );
      const newest = [...last].sort(
        (a, b) => b.revision - a.revision || a.check.path.localeCompare(b.check.path),
      );
      const entries = newest.map((t): LintChangedEntry => {
        const now = states.get(t.check.path) ?? null;
        const findings = now === null ? null : (findingsOf(store, now)?.length ?? null);
        return {
          path: t.check.path,
          kind: t.kind,
          added: t.added,
          removed: t.removed,
          revision: t.revision,
          outcome: now?.outcome ?? null,
          stale: now?.stale ?? false,
          findings,
          reason: now?.reason ?? null,
        };
      });
      return { v: 1, since: scope, entries, ...reasonsOf(store, worktreeId) };
    }),
  );
  return closedAs(read, (reasons) => ({ v: 1, since: scope, entries: [], ...reasons }));
}

/**
 * Spec 017 D8 Blocking: what Stop counts with `lint.blocking` on, for the
 * consumer whose own revisions `since` reads (`codeSeenUpTo`); with none
 * recorded, nothing is its own. `null` while `lint.blocking` is off, the
 * policy is off or the store cannot be read: lint then blocks nothing.
 */
export function lintStop(
  source: LintStoreSource | undefined,
  worktreeId: WorktreeId,
  since: CodeBound | null,
): LintStopEvidence | null {
  if (source?.policy()?.blocking !== true) return null;
  const read = withLint(source, ({ store, lint }) => {
    if (!lint.blocking) return null;
    return store.read((): LintStopEvidence => {
      const states = store.states.list(worktreeId);
      const went = since === null ? [] : wentToFail(store, worktreeId, states, since);
      const { pending, stale, unknown } = countsOf(states);
      return {
        v: 1,
        files: went.map(({ state, revision }) => ({
          path: state.check.path,
          findings: findingsOf(store, state)?.length ?? null,
          revision,
        })),
        notCurrent: { pending, stale, unknown },
      };
    });
  });
  return "read" in read ? read.read : null;
}
