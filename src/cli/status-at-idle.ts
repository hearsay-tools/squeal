import { selects } from "../core/commit/at-keys-narrow.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { CommitAskState } from "../core/types/commit-ask.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { After } from "./status-at-call-run.js";
import type { CommitAsked } from "./status-at-commit-ask.js";
import type { SideState } from "./status-at-report.js";
import type { QueuedRun } from "./status-at-report-queued.js";

/*
 * Row 023-58 (W1), review 0.1.607 B2: a `--wait` alone asks nothing, so
 * the call's files with a result on one side that the other side neither
 * has nor runs say which call asks them, and how many of them that call
 * queues. The count is the daemon's own selection, never a guess: a kept
 * ask of this call's change, paths and no `--all-missing` holds exactly
 * what the same `--run` would select (`files` and `withResult`, D4.5's
 * `choose`). Without one, the count is unknown and the text says so.
 */

/**
 * The kept ask whose selection a `--run` with `named` (the call's paths,
 * none for a wide call) and no `--all-missing` repeats: queued, of this
 * call's change; `null` when no kept ask proves it (an older daemon that
 * does not tell `named`, `allMissing` or `withResult` proves none).
 */
export function recoveryAsk(
  asked: CommitAsked,
  named: readonly RelativePath[],
): CommitAskState | null {
  const { change } = asked;
  if (change === null) return null;
  const want = new Set(named);
  const same = (paths: readonly RelativePath[]) =>
    new Set(paths).size === want.size && paths.every((p) => want.has(p));
  return (
    asked.asks.find(
      (ask) =>
        ask.phase === "queued" &&
        ask.change === change &&
        ask.allMissing === false &&
        ask.withResult !== undefined &&
        ask.named !== undefined &&
        same(ask.named),
    ) ?? null
  );
}

/** With `--wait` alone, per side, the idle files and how many of them `command` queues. */
export function idleOf(
  after: After,
  asked: CommitAsked,
  paths: readonly RelativePath[] | null,
  command: string,
): { idle?: NonNullable<QueuedRun["idle"]> } {
  const known = (s: SideState) => s.state === "pass" || s.state === "fail";
  const idle = (s: SideState) =>
    s.state === "no result" && s.pending === undefined && s.notSelected !== true;
  const them = (here: (ref: TestFileRef) => SideState, there: (ref: TestFileRef) => SideState) =>
    after.refs.filter((ref) => known(there(ref)) && idle(here(ref)));
  const commit = them(after.at.state, after.current.state);
  const now = them(after.current.state, after.at.state);
  if (commit.length + now.length === 0) return {};
  const ask = recoveryAsk(asked, paths ?? []);
  const chosen = new Set(
    ask === null ? [] : [...ask.files, ...(ask.withResult ?? [])].map(testFileId),
  );
  const refused = new Set((ask?.refused ?? []).map((r) => testFileId(r.ref)));
  // The commit side queues the selection with no result there, less what D4.9 refuses.
  const atRuns = (ref: TestFileRef) =>
    ask === null ? null : chosen.has(testFileId(ref)) && !refused.has(testFileId(ref));
  // The working tree queues the files under the call's paths, then the commit's selection.
  const nowRuns = (ref: TestFileRef) =>
    paths !== null && selects(paths, ref.path)
      ? true
      : ask === null
        ? null
        : chosen.has(testFileId(ref));
  const queues = {
    commit: countOf(commit, atRuns),
    now: countOf(now, nowRuns),
  };
  return { idle: { commit: commit.length, now: now.length, command, queues } };
}

/** How many of `files` `runs` queues; `null` when it cannot tell for one of them. */
function countOf(files: readonly TestFileRef[], runs: (ref: TestFileRef) => boolean | null) {
  let n = 0;
  for (const ref of files) {
    const r = runs(ref);
    if (r === null) return null;
    if (r) n += 1;
  }
  return n;
}
