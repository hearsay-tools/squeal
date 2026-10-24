import {
  type FocusTally,
  focusedCheckLines,
  focusedTookText,
  textsText,
} from "../core/status/focused.js";
import { fromBase } from "../core/status/next-step-text.js";
import { shellWord, timeText } from "../core/text.js";
import type {
  CheckKey,
  EpochMs,
  RevisionNumber,
  StatusFocusedCheck,
  TestFileRef,
} from "../core/types/index.js";
import type { FocusedFile, NamedFocus } from "./status-wait-focus.js";
import { sumTallies } from "./status-wait-focus-answer.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23; `tasks/011-135/design.md`
 * section 1.4): the text and JSON a named wait with `--check` adds. Each
 * focused outcome is a first run, never re-run, and never the file's
 * verdict; the file's own run decides.
 */

/** How long the printed wait for the file's own run is, as the design's text names it. */
const OWN_RUN_WAIT_MS = 600_000;

/** The line a wait gives first when its daemon does not know `focus` (C15). */
export function refusedLine(focus: NamedFocus | undefined): string | null {
  if (focus?.refused === undefined) return null;
  const version = focus.refused.version === null ? "" : ` (Squeal ${focus.refused.version})`;
  return `Focused: this daemon${version} runs whole files only; waiting for the file's run`;
}

/**
 * The focused block: per file named by its own path, its selected checks
 * with their first error and location, from its focused run or the result
 * its own run stored at its key; a selection that matched nothing; why a
 * file gets no focused run; or that it has no focused outcome yet.
 */
export function focusLines(focus: NamedFocus | undefined, base: string | undefined): string[] {
  if (focus === undefined || focus.refused !== undefined) return [];
  return focus.files.flatMap((file) => fileLines(file, focus.texts, base));
}

function fileLines(
  file: FocusedFile,
  texts: readonly string[],
  base: string | undefined,
): string[] {
  const path = fromBase(base, file.testFile.path);
  if (file.whole !== undefined)
    return [`Focused: ${path}: ${file.whole}; waiting for the file's run`];
  const { stored, run } = file;
  if (stored !== undefined) {
    if (stored.checks.length === 0) {
      return [
        `No check of ${path} holds ${textsText(texts)} in the result its own run stored at revision ${stored.revision} (${checksText(stored.collected)}).`,
      ];
    }
    return [
      `Focused: ${checksText(stored.checks.length)} of ${path} from the result its own run stored at revision ${stored.revision}, at its current key.`,
      ...focusedCheckLines(stored.checks, 0, "  "),
    ];
  }
  const { tally } = file;
  if (run === undefined || tally === undefined) {
    const running = run?.endedAt === null ? `; running since ${timeText(run.startedAt)}` : "";
    return [`Focused: ${path}: no focused outcome yet${running}`];
  }
  if (run.end === "completed" && run.matched === 0) {
    const collected =
      run.collected === null ? "" : ` (the run collected ${checksText(run.collected)})`;
    return [
      `No check of ${path} holds ${textsText(texts)} at revision ${run.revision}${collected}.`,
    ];
  }
  const took = focusedTookText(run);
  const ended =
    run.end === "completed"
      ? ""
      : `, ended ${run.end}${run.reason === null ? "" : ` (${run.reason})`}`;
  const own = run.collected === null ? "" : ` (${checksText(run.collected)})`;
  // Review 0.1.286 B2: a run for more texts that left checks out counts only what it kept.
  const count =
    tally.total === null ? `at least ${checksText(run.checks.length)}` : checksText(tally.total);
  return [
    `Focused: ${count} of ${path} at revision ${run.revision}, ${took}${ended}; not the file's verdict.`,
    ...focusedCheckLines(run.checks, run.more, "  "),
    `  A first run each, not re-run; the file's own run${own} decides.`,
  ];
}

function checksText(n: number): string {
  return `${n} ${n === 1 ? "check" : "checks"}`;
}

/**
 * The verdict line of a `focused` wait: how many selected checks failed, of
 * how many, from each file's count (review 0.1.286 B2): `at least` when a
 * list left checks out uncounted; a selection that matched nothing; or a
 * run that ended with no outcome. Then that the file has no verdict yet,
 * and the wait for its own run.
 */
export function focusedVerdictText(
  focus: NamedFocus,
  command: string,
  base: string | undefined,
): string {
  const files = focus.files.filter((f) => f.whole === undefined);
  const { failed, total, atLeast } = sumTallies(
    files.flatMap((f) => (f.tally === undefined ? [] : [f.tally])),
  );
  const them = files.length === 1 ? "the file" : "the files";
  const paths = files.map((f) => shellWord(fromBase(base, f.testFile.path))).join(" ");
  const wait = `\`${command} status --wait ${OWN_RUN_WAIT_MS} ${paths}\` waits for ${files.length === 1 ? "it" : "them"}`;
  return `Focused: ${foundText(files, focus.texts, failed, total, atLeast)}; no verdict for ${them} yet: ${wait}`;
}

function foundText(
  files: readonly FocusedFile[],
  texts: readonly string[],
  failed: number,
  total: number | null,
  atLeast: boolean,
): string {
  const checks = (n: number) => (n === 1 ? "check" : "checks");
  if (total === null) return `at least ${failed} selected ${checks(failed)} failed`;
  if (total > 0)
    return `${atLeast ? "at least " : ""}${failed} of ${total} selected ${checks(total)} failed`;
  const ends = [
    ...new Set(
      files.flatMap((f) =>
        f.stored === undefined && f.run?.end != null && f.run.end !== "completed"
          ? [f.run.end]
          : [],
      ),
    ),
  ];
  return ends.length === 0
    ? `no selected check: no check holds ${textsText(texts)}`
    : `no outcome: the focused run ended ${ends.join(" or ")}`;
}

/** One file of `selection.focused.testFiles` in `--json` (C15, additive). */
export interface FocusedFileEntry extends TestFileRef {
  /** `focused`, a focused run; `stored`, the result its own run stored at its key; `null`, none yet. */
  readonly source: "focused" | "stored" | null;
  /** Why the daemon gives it no focused run. */
  readonly reason?: string;
  readonly key: CheckKey | null;
  readonly revision: RevisionNumber | null;
  readonly texts: readonly string[];
  readonly runId: string | null;
  readonly durationMs: number | null;
  /** How the focused run ended; `null` while it runs or for a stored result. */
  readonly end: string | null;
  readonly startedAt: EpochMs | null;
  readonly matched: number | null;
  readonly collected: number | null;
  readonly checks: readonly StatusFocusedCheck[];
  readonly more: number;
  /** Review 0.1.286 B2: the count the wait answers with; `null` without an answer. */
  readonly count: FocusTally | null;
}

/** `selection.focused` in `--json`: the texts sent, each file and the older daemon's refusal. */
export interface FocusedPayload {
  readonly texts: readonly string[];
  readonly refused?: { readonly version: string | null };
  readonly testFiles: readonly FocusedFileEntry[];
}

export function focusPayload(focus: NamedFocus): FocusedPayload {
  return {
    texts: focus.texts,
    ...(focus.refused === undefined ? {} : { refused: focus.refused }),
    testFiles: focus.files.map((file) => fileEntry(file, focus.texts)),
  };
}

function fileEntry(file: FocusedFile, texts: readonly string[]): FocusedFileEntry {
  const { stored, run } = file;
  const none = {
    ...file.testFile,
    source: null,
    ...(file.whole === undefined ? {} : { reason: file.whole }),
    key: file.key,
    revision: null,
    texts,
    runId: null,
    durationMs: null,
    end: null,
    startedAt: null,
    matched: null,
    collected: null,
    checks: [],
    more: 0,
    count: file.tally ?? null,
  };
  if (stored !== undefined) {
    return {
      ...none,
      source: "stored",
      revision: stored.revision,
      runId: stored.runId,
      matched: stored.checks.length,
      collected: stored.collected,
      checks: stored.checks,
    };
  }
  if (run === undefined) return none;
  return {
    ...none,
    source: "focused",
    key: run.key,
    revision: run.revision,
    texts: run.texts,
    runId: run.runId,
    durationMs: run.durationMs,
    end: run.end,
    startedAt: run.startedAt,
    matched: run.matched,
    collected: run.collected,
    checks: run.checks,
    more: run.more,
  };
}
