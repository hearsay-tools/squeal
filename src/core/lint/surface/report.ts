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
import { readCursor, readKeying } from "../pass/records.js";
import type { LintStore, LintTransitionRecord } from "../store/types.js";
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

/** Kinds that leave a file failing. */
const LEAVES_FAIL = new Set(["first-seen-fail", "pass-to-fail", "fail-changed"]);

/**
 * D8 Blocking: the files failing at their current key that went to `fail`
 * in `since`'s revisions, with that transition's revision. Its last
 * transition must leave it failing, and its transition into `fail` must
 * come after the last first or config keying: a keying records no
 * transition per file, so a failure since then may be the keying's, not
 * the edit's. So a file that failed in the session, passed, and fails again
 * after a config change is not counted; nor is one failing since before
 * the session.
 */
export function wentToFail(
  store: LintStore,
  worktreeId: WorktreeId,
  states: readonly LintKnownState[],
  since: CodeBound,
): { readonly state: LintKnownState; readonly revision: RevisionNumber }[] {
  const failing = states.filter(isCurrentFail);
  if (failing.length === 0) return [];
  const cut = readKeying(store.meta, worktreeId)?.transition ?? 0;
  const into = new Map<RelativePath, LintTransitionRecord>();
  for (const t of store.transitions.after(worktreeId, cut)) {
    if (t.kind === "first-seen-fail" || t.kind === "pass-to-fail") into.set(t.check.path, t);
  }
  const last = new Map(store.transitions.latest(worktreeId).map((t) => [t.check.path, t]));
  return failing.flatMap((state) => {
    const t = into.get(state.check.path);
    const kind = last.get(state.check.path)?.kind;
    if (t === undefined || kind === undefined || !LEAVES_FAIL.has(kind)) return [];
    return isOwn(since, t.revision) ? [{ state, revision: t.revision }] : [];
  });
}

/**
 * Whether `path` is held by `asked`: a path equal to it, or a folder above
 * it at a `/` boundary. `.` and the empty path hold every file.
 */
function holderOf(asked: string): (path: RelativePath) => boolean {
  const folder = asked.replace(/^\.\//, "").replace(/\/+$/, "");
  if (folder === "" || folder === ".") return () => true;
  return (path) => path === folder || path.startsWith(`${folder}/`);
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
    blob: s.judged?.blob ?? null,
    reason: s.reason,
  };
}

/** The files `paths` hold, in their order, each once; the paths that hold none. */
function heldBy(states: readonly LintKnownState[], paths: readonly RelativePath[]) {
  const shown: LintKnownState[] = [];
  const seen = new Set<RelativePath>();
  const empty: RelativePath[] = [];
  for (const asked of paths) {
    const held = states.filter((s) => holderOf(asked)(s.check.path));
    if (held.length === 0) empty.push(asked);
    for (const s of held) {
      if (seen.has(s.check.path)) continue;
      seen.add(s.check.path);
      shown.push(s);
    }
  }
  return { shown, empty };
}

/**
 * Spec 017 D8 Details, `squeal lint [<path>...]`: with no path, every file
 * failing at its last judged result, stale ones marked, newest first; with
 * paths, the files each holds in their order, and the paths that hold none
 * apart: not linted once a keying has run, else waiting.
 */
export function lintDetails(
  source: LintStoreSource | undefined,
  worktreeId: WorktreeId,
  paths?: readonly RelativePath[],
): LintDetails | undefined {
  const read = withLint(source, ({ store }) =>
    store.read((): LintDetails => {
      const states = store.states.list(worktreeId);
      const { shown, empty } =
        paths === undefined
          ? { shown: states.filter((s) => s.outcome === "fail").sort(newestFirst), empty: [] }
          : heldBy(states, paths);
      const { pending, stale, unknown } = countsOf(states);
      const linting = progressOf(store, worktreeId, states);
      const keyed = readCursor(store.meta, worktreeId) !== null;
      return {
        v: 1,
        files: shown.map((s) => detailOf(store, s)),
        notLinted: keyed ? empty : [],
        waiting: keyed ? [] : empty,
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
    notLinted: [],
    waiting: [...(paths ?? [])],
    pending: 0,
    stale: 0,
    unknown: 0,
    ...(reasons.unreadable === undefined ? NOT_STARTED : reasons),
  }));
}

/** Newest judged first, then by path. */
const newestFirst = (a: LintKnownState, b: LintKnownState) =>
  (b.judged?.revision ?? 0) - (a.judged?.revision ?? 0) || a.check.path.localeCompare(b.check.path);

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
      const holders = (paths ?? ["."]).map(holderOf);
      const last =
        since === null
          ? []
          : store.transitions
              .latest(worktreeId)
              .filter((t) => isOwn(since, t.revision) && holders.some((h) => h(t.check.path)));
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
          blob: now?.judged?.blob ?? null,
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
