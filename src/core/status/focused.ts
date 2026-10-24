import { testFileId } from "../keys/index.js";
import { type FocusedRun, readFocused } from "../scheduler/focused-row.js";
import { checkIdentity, formatCheck, testFileOf } from "../state/index.js";
import { timeText } from "../text.js";
import type {
  CheckId,
  CheckKey,
  PendingPhase,
  StatusFocused,
  StatusFocusedCheck,
  StatusSnapshot,
  Store,
  TestFileRef,
  WhyFocused,
  WorktreeId,
} from "../types/index.js";

/*
 * Row 011-146 (011 C5 and C6 as amended 2026-10-23; `tasks/011-135/design.md`
 * section 2.3): the focused runs status, `why` and the focused wait read
 * from the meta row the daemon writes (row 011-145). A focused run is never
 * a result: nothing here feeds a count, a known failure, a duration or a
 * checkpoint. An entry applies while its key is its file's current key and
 * no result is stored at that key; else the file's own result or a newer
 * key supersedes it.
 */

/** How many applying entries status names before "and N more" (C6). */
export const FOCUSED_SHOWN = 3;

/** How many failing check names a status line gives before "and N more". */
const NAMES_SHOWN = 3;

/**
 * `worktreeId`'s focused runs, oldest first, each with whether it applies
 * and its file's phase in `phases` (`pendingPhasesOf`, uncapped).
 */
export function readStatusFocused(
  store: Store,
  worktreeId: WorktreeId,
  phases: ReadonlyMap<string, { readonly phase: PendingPhase }>,
): StatusFocused[] {
  const runs = readFocused(store, worktreeId);
  if (runs.length === 0) return [];
  const files = runs.map((run) => run.testFile);
  const keys = new Map(
    store.testFileKeys.list(worktreeId, files).map((row) => [testFileId(row.testFile), row.key]),
  );
  return runs.map((run) => {
    const current = keys.get(testFileId(run.testFile)) === run.key;
    // `usedAt` 0: a read, not a lookup hit (status writes nothing, C6).
    const applies = current && store.results.byKey(run.key, 0).length === 0;
    const phase = phases.get(testFileId(run.testFile))?.phase ?? null;
    return { ...statusFocusedOf(run, applies), phase };
  });
}

/** `run` as status and `why` give it. */
export function statusFocusedOf(run: FocusedRun, applies: boolean): StatusFocused {
  const checks: StatusFocusedCheck[] = run.checks.map((c) => ({
    check: c.check,
    name: formatCheck(c.check),
    outcome: c.outcome,
    durationMs: c.durationMs,
    summary: c.summary,
    location: c.location,
  }));
  return {
    testFile: run.testFile,
    key: run.key,
    revision: run.revision,
    texts: run.texts,
    runId: run.runId,
    logDir: run.logDir,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.endedAt === null ? null : Math.max(0, run.endedAt - run.startedAt),
    end: run.end,
    reason: run.reason,
    collected: run.collected,
    matched: run.matched,
    checks,
    more: run.more,
    applies,
  };
}

/** A check's name within its file: its full name, or the printed name of a file-level check. */
function ownName(c: StatusFocusedCheck): string {
  return c.check.kind === "test" ? c.check.fullName : c.name;
}

/** `"a", "b"`: the texts as the agent gave them. */
export function textsText(texts: readonly string[]): string {
  return texts.map((text) => JSON.stringify(text)).join(", ");
}

/** As status names a file: the project, when there is one, leads the path. */
export function focusedFileText({ project, path }: TestFileRef): string {
  return project === "" ? path : `${project}: ${path}`;
}

/**
 * What a focused run found, after its file and revision: `2 of 2 selected
 * checks FAIL (a, b)`, a selection that matched nothing, how it ended when
 * it did not complete, or that it runs.
 */
export function focusedOutcomeText(entry: StatusFocused): string {
  if (entry.endedAt === null) {
    return `running since ${timeText(entry.startedAt)} (focused: ${textsText(entry.texts)})`;
  }
  const failed = entry.checks.filter((c) => c.outcome === "fail");
  if (entry.end === "completed" && entry.matched === 0) return noMatchText(entry);
  const total = entry.checks.length + entry.more;
  const names = failed.slice(0, NAMES_SHOWN).map((c) => ownName(c));
  const rest = failed.length > names.length ? ` and ${failed.length - names.length} more` : "";
  const counted = `${failed.length} of ${total} selected ${total === 1 ? "check" : "checks"} FAIL${names.length === 0 ? "" : ` (${names.join(", ")}${rest})`}`;
  if (entry.end === "completed") return counted;
  const why = entry.reason === null ? "" : `: ${entry.reason}`;
  return `${entry.end}${why}${total === 0 ? "" : `; ${counted}`}`;
}

/** `no check holds "x" (the run collected 78 checks)`. */
export function noMatchText(entry: StatusFocused): string {
  const collected =
    entry.collected === null
      ? ""
      : ` (the run collected ${entry.collected} ${entry.collected === 1 ? "check" : "checks"})`;
  return `no check holds ${textsText(entry.texts)}${collected}`;
}

/** `7.8 s`, a focused run's time: seconds, as a wait names its own. */
export function focusedSecondsText(ms: number): string {
  return `${(ms / 1_000).toFixed(1)} s`;
}

/** `run alone in 7.8 s`, or nothing while it runs. */
export function focusedTookText(entry: StatusFocused): string {
  return entry.durationMs === null ? "" : `run alone in ${focusedSecondsText(entry.durationMs)}`;
}

/**
 * Each of `checks` on its own lines: its outcome and its name within its
 * file, then its first error and location when it has them, after
 * `indent`; then how many `more` there are.
 */
export function focusedCheckLines(
  checks: readonly StatusFocusedCheck[],
  more: number,
  indent: string,
): string[] {
  const lines = checks.flatMap((c) => [
    `${indent}${c.outcome === "fail" ? "FAIL" : c.outcome}  ${ownName(c)}`,
    ...(c.summary === null || c.summary === "" ? [] : [`${indent}      ${c.summary}`]),
    ...(c.location === null
      ? []
      : [`${indent}      at ${c.location.path}:${c.location.line}:${c.location.column}`]),
  ]);
  return more === 0 ? lines : [...lines, `${indent}and ${more} more selected checks`];
}

/**
 * 011 C6 as amended 2026-10-23: a line per test file whose focused entry
 * applies, at most `FOCUSED_SHOWN`, then `and N more`; with `full`, its
 * selected checks one per line. None from a payload before the field.
 */
export function focusedLines(s: StatusSnapshot, full = false): string[] {
  const applying = (s.focused ?? []).filter((entry) => entry.applies);
  if (applying.length === 0) return [];
  const running = new Set((s.pendingTestFiles?.running.files ?? []).map(testFileId));
  const shown = applying.slice(-FOCUSED_SHOWN).reverse();
  const lines = shown.flatMap((entry) => {
    // Its phase read before the lists' cap; a payload before the field, the named running files.
    const phase =
      entry.phase !== undefined
        ? entry.phase
        : running.has(testFileId(entry.testFile))
          ? "running"
          : "queued";
    const own = phase ?? "not queued";
    const head =
      `Focused (not counted): ${focusedFileText(entry.testFile)} at revision ${entry.revision}: ` +
      `${focusedOutcomeText(entry)}; its own run is ${own}.`;
    return full ? [head, ...focusedCheckLines(entry.checks, entry.more, "  ")] : [head];
  });
  const more = applying.length - shown.length;
  return more > 0 ? [...lines, `  and ${more} more`] : lines;
}

/**
 * The checks this worktree's focused runs recorded, which `why` resolves a
 * name against: a check first seen in a focused run has no other record
 * (C5, review 0.1.286 B3). A run in flight has recorded none.
 */
export function focusedCheckIds(store: Store, worktreeId: WorktreeId): CheckId[] {
  return readFocused(store, worktreeId).flatMap((run) => run.checks.map((c) => c.check));
}

/**
 * 011 C6 as amended 2026-10-23: the newest focused run of `check`'s test
 * file in `worktreeId` when it selected `check`, read against the file's
 * current `key`; `undefined` otherwise, a run in flight included.
 */
export function whyFocusedOf(
  store: Store,
  worktreeId: WorktreeId,
  check: CheckId,
  key: CheckKey | null,
): WhyFocused | undefined {
  const file = testFileId(testFileOf(check));
  const run = readFocused(store, worktreeId).find((r) => testFileId(r.testFile) === file);
  if (run === undefined) return undefined;
  const at = run.checks.findIndex((c) => checkIdentity(c.check) === checkIdentity(check));
  if (at === -1) return undefined;
  const keyMoved = key !== run.key;
  // `usedAt` 0: a read, not a lookup hit.
  const status = statusFocusedOf(run, !keyMoved && store.results.byKey(run.key, 0).length === 0);
  const result = status.checks[at];
  return result === undefined ? undefined : { run: status, result, keyMoved };
}

/**
 * `why`'s line below the known state: `Focused run at revision 4 (7.8 s,
 * log <dir>): FAIL, not a stored result; the file's own run decides`, then
 * why it no longer applies: its key moved, or its own run stored a result.
 */
export function whyFocusedLines(focused: WhyFocused | undefined): string[] {
  if (focused === undefined) return [];
  const { run, result, keyMoved } = focused;
  const took = run.durationMs === null ? "" : `${focusedSecondsText(run.durationMs)}, `;
  const outcome = result.outcome.toUpperCase();
  const since = run.applies
    ? ""
    : keyMoved
      ? "; its key moved since"
      : "; the file's own run stored its result at this key since";
  return [
    `  Focused run at revision ${run.revision} (${took}log ${run.logDir}): ${outcome}, not a stored result; the file's own run decides${since}`,
  ];
}
