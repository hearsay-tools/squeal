import type { FocusedRun } from "../core/scheduler/focused-row.js";
import { statusFocusedOf } from "../core/status/focused.js";
import type { StatusFocused, StatusFocusedCheck } from "../core/types/index.js";

/*
 * Row 011-146 (011 C5 and C15 as amended 2026-10-23; review 0.1.286 B1 and
 * B2): how one focused run answers one wait. A run for more texts answers
 * with only the checks that hold one of the wait's. An entry keeps at most
 * 50 checks, so only a count over every selected check proves a pass. One
 * count (`FocusTally`) gives the wait's exit status, its lines and its JSON.
 */

/**
 * What a file's selected checks add up to: `failed` of `total`; `total` is
 * `null` when the run left checks out of its list and nothing counts them
 * for the wait's texts; `atLeast` when one it left out may have failed too.
 */
export interface FocusTally {
  readonly failed: number;
  readonly total: number | null;
  readonly atLeast: boolean;
}

/**
 * A run's answer to a wait: the run as the wait reads it; its count once it
 * ended with one; or why it gives none, so the wait waits for the file's run.
 */
export interface FocusAnswer {
  readonly run: StatusFocused;
  readonly tally?: FocusTally;
  readonly fallback?: string;
}

/** Whether a check's full name holds one of `texts`, the rule every runner's filter keeps (C14). */
export function holdsText(fullName: string, texts: readonly string[]): boolean {
  return texts.some((text) => fullName.includes(text));
}

/** A focused run that ended with an outcome the wait returns at; a discarded or cancelled one runs again. */
export function answeredRun(run: StatusFocused): boolean {
  return run.end !== null && run.end !== "discarded" && run.end !== "cancelled";
}

/**
 * `run`'s answer to a wait for `texts`: as recorded when it ran for the
 * same texts; when it ran for more, only its checks that hold one of
 * `texts`, and its file-level failure (B1). `undefined` when it ran without
 * one of `texts`, or ran for more, left selected checks out of its list and
 * kept no fail of this wait's: the wait asks for its own run. A list cut
 * with no count and no kept fail proves no pass: the `fallback` (B2).
 */
export function answerOf(run: FocusedRun, texts: readonly string[]): FocusAnswer | undefined {
  if (!texts.every((t) => run.texts.includes(t))) return undefined;
  const status = statusFocusedOf(run, true);
  const same = run.texts.every((t) => texts.includes(t));
  const view = same ? status : projected(status, texts);
  if (!answeredRun(view)) return { run: view };
  const failed = view.checks.filter((c) => c.outcome === "fail").length;
  if (same && view.outcomes !== undefined) {
    const { pass, fail, skip } = view.outcomes;
    return { run: view, tally: { failed: fail, total: pass + fail + skip, atLeast: false } };
  }
  if (status.more === 0) {
    return { run: view, tally: { failed, total: view.checks.length, atLeast: false } };
  }
  if (failed > 0) {
    const total = same ? view.checks.length + view.more : null;
    return { run: view, tally: { failed, total, atLeast: true } };
  }
  if (!same) return undefined;
  const kept = view.checks.length;
  return {
    run: view,
    fallback: `its focused run kept ${kept} of ${kept + view.more} selected checks, none failing, and counted none of the rest`,
  };
}

/** `status` with only its checks that hold one of `texts` and its file-level ones; no count of its own texts. */
function projected(status: StatusFocused, texts: readonly string[]): StatusFocused {
  const checks = status.checks.filter(
    (c) => c.check.kind !== "test" || holdsText(c.check.fullName, texts),
  );
  const tests = checks.filter((c) => c.check.kind === "test").length;
  const { outcomes: _, ...rest } = status;
  const matched = status.matched === null || status.more > 0 ? null : tests;
  return { ...rest, checks, matched, more: 0 };
}

/** The count of a stored result's selected checks: every one is stored, so it is exact. */
export function storedTally(checks: readonly StatusFocusedCheck[]): FocusTally {
  const failed = checks.filter((c) => c.outcome === "fail").length;
  return { failed, total: checks.length, atLeast: false };
}

/** The count of several files' answers: their sums; `total` `null` when one is not known. */
export function sumTallies(tallies: readonly FocusTally[]): FocusTally {
  const failed = tallies.reduce((n, t) => n + t.failed, 0);
  const totals = tallies.map((t) => t.total);
  const total = totals.every((t) => t !== null) ? totals.reduce((n, t) => n + t, 0) : null;
  return { failed, total, atLeast: tallies.some((t) => t.atLeast) };
}
