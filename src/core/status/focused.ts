import { testFileId } from "../keys/index.js";
import { type FocusedRun, readFocused } from "../scheduler/focused-row.js";
import { durationText, formatCheck } from "../state/index.js";
import { timeText } from "../text.js";
import type {
  StatusFocused,
  StatusFocusedCheck,
  StatusSnapshot,
  Store,
  TestFileRef,
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

/** `worktreeId`'s focused runs, oldest first, each with whether it applies. */
export function readStatusFocused(store: Store, worktreeId: WorktreeId): StatusFocused[] {
  const runs = readFocused(store, worktreeId);
  if (runs.length === 0) return [];
  const files = runs.map((run) => run.testFile);
  const keys = new Map(
    store.testFileKeys.list(worktreeId, files).map((row) => [testFileId(row.testFile), row.key]),
  );
  return runs.map((run) => {
    const current = keys.get(testFileId(run.testFile)) === run.key;
    // `usedAt` 0: a read, not a lookup hit (status writes nothing, C6).
    return statusFocusedOf(run, current && store.results.byKey(run.key, 0).length === 0);
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

/** `run alone in 7.8 s`, or nothing while it runs. */
export function focusedTookText(entry: StatusFocused): string {
  return entry.durationMs === null ? "" : `run alone in ${durationText(entry.durationMs)}`;
}

/**
 * Each selected check of `entry` on its own lines: its outcome and name,
 * then its first error and location when it has them, after `indent`.
 */
export function focusedCheckLines(entry: StatusFocused, indent: string): string[] {
  const lines = entry.checks.flatMap((c) => [
    `${indent}${c.outcome === "fail" ? "FAIL" : c.outcome}  ${ownName(c)}`,
    ...(c.summary === null || c.summary === "" ? [] : [`${indent}      ${c.summary}`]),
    ...(c.location === null
      ? []
      : [`${indent}      at ${c.location.path}:${c.location.line}:${c.location.column}`]),
  ]);
  return entry.more === 0 ? lines : [...lines, `${indent}and ${entry.more} more selected checks`];
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
    const own = running.has(testFileId(entry.testFile)) ? "running" : "queued";
    const head =
      `Focused (not counted): ${focusedFileText(entry.testFile)} at revision ${entry.revision}: ` +
      `${focusedOutcomeText(entry)}; its own run is ${own}.`;
    return full ? [head, ...focusedCheckLines(entry, "  ")] : [head];
  });
  const more = applying.length - shown.length;
  return more > 0 ? [...lines, `  and ${more} more`] : lines;
}
