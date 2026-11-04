import type { EpochMs, FileHash, RelativePath, WorktreeId } from "../../types/index.js";
import type { LintFinding, LintKnownState, LintTool, LintTransition } from "../../types/lint.js";
import { findingMessage } from "../fingerprint.js";
import type { LintStore } from "../store/types.js";
import { lintTransition } from "../transition.js";
import {
  type CommittedPath,
  lintScope,
  readCommitted,
  readKeying,
  readQuiet,
  releaseKey,
  writeBlobs,
  writeCommitted,
  writeQuiet,
} from "./records.js";

/*
 * Row 019-43 (lessons Round 3 P12), review 0.1.402 B1: a commit's lint
 * result is news, as an edit's is. A delivery tells one file only by a
 * transition after the last first or config keying's cut (017 D8), so a
 * commit's path keeps its provenance while its file is the committed blob,
 * and each pass of its held tool gives its result such a transition:
 *
 * - While it waits to lint, it is released again at that blob if its
 *   release was spent (a config keying keyed it again), and it loses a
 *   keying's quiet mark, so its lint records the transition (lint-part).
 *   When its last result fails and the cut hid that result's transition
 *   (a config keying came before any delivery), that result is told first:
 *   its lint, measured against it, then adds only what changed.
 * - Once settled, its result gets a transition when the check has none
 *   after the cut or the result differs from what its transitions told. A
 *   stored result another worktree made, which a first, config or edit
 *   keying judged quietly before or after the release, is told so. This
 *   runs after the keying wrote its cut, so the cut never hides it.
 *
 * A settled path is looked at once per keying. A consumer whose view holds
 * the result already is told nothing (D8's view). A request's release
 * writes no provenance and stays quiet (019-22).
 */

/** A check waits to lint: pending, or stale, whose outcome is an old one (017 D5). */
export function waitsToLint(state: Pick<LintKnownState, "outcome" | "stale">): boolean {
  return state.outcome === "pending" || state.stale;
}

/** What a check's transitions told of its findings, oldest first; `null` with none. */
function toldFindings(history: readonly LintTransition[]): LintFinding[] | null {
  if (history.length === 0) return null;
  const key = (f: LintFinding) => JSON.stringify([f.rule, findingMessage(f)]);
  const told: LintFinding[] = [];
  for (const t of history) {
    for (const gone of t.removed) {
      const at = told.findIndex((f) => key(f) === key(gone));
      if (at >= 0) told.splice(at, 1);
    }
    told.push(...t.added);
  }
  return told;
}

/**
 * The transition that gives a settled result a delivery path, or `null`
 * when one does. With no transition of the check after the cut
 * (`visible`), a failing result is told whole, as first seen; else, and
 * for a pass, the change from what its transitions told. `null` too when
 * the result is no longer stored, so no finding could be named.
 */
function untoldChange(
  store: LintStore,
  state: LintKnownState,
  visible: boolean,
  now: EpochMs,
): LintTransition | null {
  const { judged } = state;
  if (judged === null) return null;
  const findings =
    judged.outcome === "pass" ? [] : store.results.get(state.check, judged.key)?.findings;
  if (findings === undefined) return null;
  const replay = visible || findings.length === 0;
  const before = replay
    ? toldFindings(store.transitions.history(state.worktreeId, state.check))
    : null;
  const change = lintTransition(before, findings, "edit");
  if (change === null) return null;
  return {
    ...change,
    worktreeId: state.worktreeId,
    check: state.check,
    revision: judged.revision,
    at: now,
  };
}

/** What one commit's path changes in a pass. */
interface PathStep {
  /** Its next entry; absent, it is dropped. */
  readonly next?: CommittedPath;
  /** It waits to lint at its blob. */
  readonly waits?: true;
  readonly change?: LintTransition | null;
}

/**
 * One commit's path at keying `seq`: dropped once its file is no longer
 * the committed blob or the tool lints it no more; while it waits, its
 * last failing result told when the cut hid it; once settled, given a
 * delivery path once per keying.
 */
function pathStep(
  store: LintStore,
  entry: CommittedPath,
  state: LintKnownState | undefined,
  at: { readonly seq: number; readonly blob: FileHash | null; readonly now: EpochMs },
  isVisible: () => boolean,
): PathStep {
  if (state === undefined || at.blob !== entry.blob) return {};
  if (waitsToLint(state)) {
    const hidden = state.judged?.outcome === "fail" && !isVisible();
    const change = hidden ? untoldChange(store, state, false, at.now) : null;
    return { next: { blob: entry.blob, seq: 0 }, waits: true, change };
  }
  if (state.outcome === "unknown" || entry.seq === at.seq) return { next: entry };
  const change = untoldChange(store, state, isVisible(), at.now);
  return { next: { blob: entry.blob, seq: at.seq }, change };
}

/**
 * One pass's step for a tool held for a commit, after its keying and
 * `releasedNow`: `released` (the live releases) gains each commit's path
 * that waits again at its blob.
 */
export function committedNews(
  store: LintStore,
  worktreeId: WorktreeId,
  tool: LintTool,
  released: Map<RelativePath, FileHash>,
  blobOf: (path: RelativePath) => FileHash | null,
  now: EpochMs,
): void {
  const { meta } = store;
  const scope = lintScope(worktreeId, tool);
  const committed = readCommitted(meta, scope);
  if (committed.size === 0) return;
  const keying = readKeying(meta, worktreeId);
  const states = store.states.list(worktreeId, { paths: [...committed.keys()], tool });
  const byPath = new Map(states.map((s) => [s.check.path, s]));
  let visible: Set<RelativePath> | null = null;
  const visibleNow = () =>
    (visible ??= new Set(
      store.transitions
        .latest(worktreeId)
        .filter((t) => t.check.tool === tool && t.id > (keying?.transition ?? 0))
        .map((t) => t.check.path),
    ));
  const next = new Map<RelativePath, CommittedPath>();
  const told: LintTransition[] = [];
  const wait: RelativePath[] = [];
  for (const [path, entry] of committed) {
    const at = { seq: keying?.seq ?? 0, blob: blobOf(path), now };
    const step = pathStep(store, entry, byPath.get(path), at, () => visibleNow().has(path));
    if (step.next !== undefined) next.set(path, step.next);
    if (step.waits) wait.push(path);
    if (step.change != null) told.push(step.change);
  }
  const lost = wait.filter((path) => !released.has(path));
  for (const path of lost) released.set(path, committed.get(path)?.blob as FileHash);
  const quiet = wait.length === 0 ? null : readQuiet(meta, scope);
  const loud = quiet !== null && wait.filter((path) => quiet.delete(path)).length > 0;
  const same = JSON.stringify([...next]) === JSON.stringify([...committed]);
  if (same && told.length + lost.length === 0 && !loud) return;
  store.transaction(() => {
    writeCommitted(meta, scope, next);
    if (told.length > 0) store.transitions.append(told);
    if (lost.length > 0) writeBlobs(meta, releaseKey(scope), released);
    if (loud) writeQuiet(meta, scope, quiet);
  });
}
