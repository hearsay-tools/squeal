import { basename, dirname } from "node:path";
import { closureLine } from "../delivery/provenance.js";
import { testFileLabel } from "../run-log.js";
import { causeText, flakyText, formatCheck, revisionText } from "../state/index.js";
import { plural } from "../text.js";
import type {
  KnownOutcome,
  KnownState,
  Transition,
  WhyChangedSince,
  WhyNoMatch,
  WhyRankedBy,
  WhyReport,
  WhyResult,
  WhyResultEntry,
  WhyRunLog,
  WhyRunLogGap,
} from "../types/index.js";
import { durationsText } from "./durations.js";
import { formatUnavailable, shortCommit } from "./format-status.js";
import { locationText } from "./test-frame.js";

const INDENT = "        ";

/** Human rendering of `squeal why <check>`. Full stacks included: the reader asked for them. */
export function formatWhy(why: WhyResult): string {
  if (!why.available) return formatUnavailable(why);
  if (!why.found) {
    const ranked = rankedLine(why.rankedBy)
      .map((line) => `${line}\n`)
      .join("");
    if (why.candidates.length === 0) return `${noMatch(why)}${ranked}`;
    return `${[
      `"${why.query}" matches ${why.candidates.length} checks in this worktree:`,
      ...why.candidates.map((c, i) => {
        const d = why.candidateDurations[i];
        return `  ${formatCheck(c)}${d == null ? "" : `  ${durationsText(d)}`}`;
      }),
    ].join("\n")}\n${ranked}`;
  }
  const lines = [
    `Check: ${formatCheck(why.check)}`,
    `Worktree: ${why.worktreeRoot}`,
    `Revision: ${why.revision === null ? "none recorded" : revisionText(why.revision, why.commit)}`,
    "",
    ...knownState(why, why.knownState),
    "",
    ...history(why.history),
    "",
    ...durationsLine(why),
    ...results(why),
    "",
    ...runLog(why),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * 011 C4 as amended (gh-31, task 011-17): Squeal cannot know an unrun test's
 * name, so with queued files left it says the test may be in one of them and
 * never that it does not exist.
 */
function noMatch(why: WhyNoMatch): string {
  const none = `No check matches "${why.query}" in this worktree.`;
  const queued = why.queuedWithoutResult ?? 0;
  if (queued === 0) return `${none}\n`;
  const files =
    queued === 1
      ? "1 test file is queued or running without a result at its current key"
      : `${queued} test files are queued or running without a result at their current keys`;
  return `${none} ${files}; a test that has not run yet has no name here, so it may be in ${queued === 1 ? "it" : "one of them"}.\n`;
}

function knownState(why: WhyReport, s: KnownState | null): string[] {
  return [
    ...stateLines(why, s),
    ...changedLine(why.changedSince),
    ...closureLines(why),
    ...rankedLine(why.rankedBy).map((line) => `  ${line}`),
    ...replacedLine(why),
    ...heldLine(why),
    ...flakyLine(why),
    ...rerunFirstLines(why, s),
  ];
}

/**
 * Task 001-225 (005 D6): what changed since the known state's revision, when
 * that is older than the current one, so a reader need not guess at the gap.
 */
function changedLine(since: WhyChangedSince | undefined): string[] {
  if (since === undefined) return [];
  const paths = since.paths.map(({ path, revisions, revisionCount }) => {
    const numbers = `${revisionCount === 1 ? "revision" : "revisions"} ${revisions.join(", ")}`;
    const capped = revisionCount > revisions.length;
    return `${path} (${numbers}${capped ? ` (first ${revisions.length} of ${revisionCount} revisions)` : ""})`;
  });
  const capped =
    since.total > since.paths.length
      ? ` (first ${since.paths.length} of ${since.total} paths)`
      : "";
  return [`  Changed since revision ${since.revision}${capped}: ${paths.join(", ")}`];
}

/** 004 D2 as amended (task 004-82): the tokens that put a slow file ahead in its class. */
function rankedLine(rankedBy: WhyRankedBy | undefined): string[] {
  if (rankedBy === undefined) return [];
  const tokens = rankedBy.tokens.join(", ");
  return [
    `Slow order: ${rankedBy.testFile} runs ahead by evidence: it selects ${tokens}, tokens of the files edited`,
  ];
}

/** 011 C5 as amended (gh-32): whether the failure's closure reads the session's changes, a fact. */
function closureLines(why: WhyReport): string[] {
  const line = closureLine(why.changesInClosure);
  return line === null ? [] : [`  ${line.charAt(0).toUpperCase()}${line.slice(1)}`];
}

/**
 * Issue 15 (011-04): a later run replaced the result behind the state at its
 * key, so the errors stored there are that run's, said with its worktree.
 */
function replacedLine(why: WhyReport): string[] {
  const replaced = why.replacedAtKey;
  if (replaced === undefined) return [];
  const where = worktreeName(why, replaced.worktreeId);
  return [
    `  Result at key ${replaced.key.slice(0, 12)}: replaced by run ${replaced.runId} in ${where} at ${new Date(replaced.recordedAt).toISOString()}; the result and errors stored there are that run's, not those behind this state`,
    `    Its log: ${replaced.logDir ?? "run record pruned"}`,
  ];
}

/** Task 001-170: another worktree's fail this worktree has not confirmed yet. */
function heldLine(why: WhyReport): string[] {
  const held = why.heldFailure;
  if (held === undefined) return [];
  const { worktreeId, commit } = held.provenance;
  const source = why.worktreeRoots[worktreeId] ?? `removed worktree ${worktreeId}`;
  return [`  Inherited FAIL from ${source} at ${shortCommit(commit)}, being confirmed`];
}

/** Task 001-170: the check's stored outcome flipped under one key; a replaced fail's error (011-19). */
function flakyLine(why: WhyReport): string[] {
  const note = why.flaky;
  if (note === undefined) return [];
  return [
    `  ${capitalize(flakyText(note))} (key ${note.key.slice(0, 12)}, ${new Date(note.at).toISOString()})`,
    ...(note.failure === undefined ? [] : [`    the FAIL it replaced: ${note.failure}`]),
  ];
}

/**
 * Gh-20 (review wave-2b B2): the first error of the check's one re-run, when
 * neither the state nor the flaky note already says it: a re-run that failed
 * differently replaced it at the key.
 */
function rerunFirstLines(why: WhyReport, s: KnownState | null): string[] {
  const first = why.rerunFirstFailure;
  if (first === undefined) return [];
  if (first.failure === s?.summary || first.failure === why.flaky?.failure) return [];
  return [
    `  First error, before its re-run (run ${first.runId}, key ${first.key.slice(0, 12)}): ${first.failure}`,
    `    Its log: ${first.logDir ?? "run record pruned"}`,
  ];
}

function stateLines(why: WhyReport, s: KnownState | null): string[] {
  if (s === null) return ["Known state: none in this worktree"];
  const head = [
    upper(s.outcome),
    s.pendingPhase === null ? s.validity : `${s.validity} (${s.pendingPhase})`,
    ...(s.observedAt === null ? [] : [`observed at revision ${s.observedAt}`]),
    ...(s.commit === null ? [] : [`commit ${shortCommit(s.commit)}`]),
  ];
  const lines = [`Known state: ${head.join(", ")}`];
  if (s.origin?.kind === "inherited") {
    const source =
      why.worktreeRoots[s.origin.worktreeId] ?? `removed worktree ${s.origin.worktreeId}`;
    lines.push(`  Origin: inherited from ${source} at ${shortCommit(s.origin.commit)}`);
  }
  if (s.summary !== null) lines.push(`  Summary: ${s.summary}`);
  if (s.location !== null) {
    // 011 C5 as amended 2026-10-21 (gh-67): the test-file frame beside a helper's location.
    lines.push(`  Location: ${locationText(s.location, why.testFileFrame)}`);
  }
  if (s.fingerprint !== null) lines.push(`  Fingerprint: ${s.fingerprint}`);
  return lines;
}

function history(transitions: readonly Transition[]): string[] {
  if (transitions.length === 0) return ["History: no transitions in this worktree"];
  return [
    `History (${plural(transitions.length, "transition")}, oldest first):`,
    ...transitions.map(
      (t) => `  revision ${t.revision}  ${new Date(t.at).toISOString()}  ${transitionText(t)}`,
    ),
  ];
}

/** Styleguide: "Transitions are written `PASS -> FAIL`, uppercase". */
function transitionText(t: Transition): string {
  if (t.kind === "first-seen-fail") return "first seen FAIL";
  const change = `${t.from === null ? "NONE" : upper(t.from)} -> ${upper(t.to)}`;
  return t.kind === "fail-changed" ? `${change}, failure changed` : change;
}

/** Task 001-411: one line above the results, over every stored result of the check. */
function durationsLine(why: WhyReport): string[] {
  return why.durations === null ? [] : [`Durations ${durationsText(why.durations)}`];
}

function results(why: WhyReport): string[] {
  if (why.results.length === 0) return ["Results: none stored"];
  return [
    `Results (${why.results.length}, newest first):`,
    ...why.results.flatMap((entry) => resultLines(why, entry)),
  ];
}

function resultLines(why: WhyReport, { result, worktreeRoot, logDir }: WhyResultEntry): string[] {
  const p = result.provenance;
  const where =
    p.worktreeId === why.worktreeId
      ? `${worktreeRoot ?? why.worktreeRoot} (this worktree)`
      : (worktreeRoot ?? `removed worktree ${p.worktreeId}`);
  const lines = [
    `  ${upper(result.outcome).padEnd(4)}  ${new Date(p.recordedAt).toISOString()}  ${where}, revision ${p.revision}, commit ${shortCommit(p.commit)}, ${p.dirty ? "dirty" : "clean"}`,
    `${INDENT}run ${p.runId}, ${Math.round(result.durationMs)} ms, key ${result.key.slice(0, 12)}${replacedHere(why, result) ? ", replaced the result behind this worktree's known state" : ""}`,
    `${INDENT}log: ${logDir ?? "run record pruned"}`,
  ];
  if (result.summary !== null) lines.push(`${INDENT}${result.summary}`);
  for (const error of result.errors) {
    const head = error.stack ?? `${error.name}: ${error.message}`;
    // Task 001-361: the code and the causes a stack does not print.
    const text = [
      head,
      error.code === undefined || head.includes(error.code) ? null : `code: ${error.code}`,
      ...(error.causes ?? []).map((cause) => `Caused by: ${causeText(cause)}`),
      error.diff,
    ]
      .filter((part) => part !== null)
      .join("\n");
    for (const line of text.split("\n")) lines.push(`${INDENT}${line}`);
  }
  return lines;
}

/**
 * Task 001-173: where the shown result's console output is, and with
 * `--include-logs` its lines. Task 001-188: a node:test file's own logs, and
 * no run named when none is identifiably the producer.
 */
function runLog(why: WhyReport): string[] {
  const log = why.runLog;
  if (log === null) return [`Run log: unknown, ${gapText(why.runLogUnavailable)}`];
  const where = producer(why, log);
  const file = testFileLabel(why.check.project, why.check.testPath);
  if (log.state === "pruned") {
    return [`Run log: ${log.path} was pruned; run ${log.runId} in ${where} left no output`];
  }
  if (log.state === "not-vitest") {
    return [
      `Run log: none, run ${log.runId} in ${where} wrote no ${basename(log.path)}`,
      `  Its runner's output is under ${dirname(log.path)}`,
      ...(log.console === null ? [] : [`  No console of ${file} was captured in this run.`]),
    ];
  }
  const lines = log.fromProducer
    ? [
        `Run log: ${log.path}`,
        `  Run ${log.runId} in ${where} produced the known state; its stored result was replaced or pruned, so the log holds its output and the results above do not. ${log.state === "node-test" ? `Under node:test ${file} has its own logs: stdout above, stderr ${log.stderrPath ?? "not recorded"}.` : "The log covers that whole run, every test file in it, not only this check."}`,
      ]
    : log.state === "node-test"
      ? [
          `Run log: ${log.path}`,
          `  Run ${log.runId} in ${where} produced the result shown. Under node:test ${file} has its own logs: stdout above, stderr ${log.stderrPath ?? "not recorded"}.`,
        ]
      : [
          `Run log: ${log.path}`,
          `  Run ${log.runId} in ${where} produced the result shown. The log covers that whole run, every test file in it, not only this check.`,
        ];
  const source = log.state === "node-test" ? "these logs" : "this log";
  if (log.console === null) {
    lines.push(
      `  --include-logs prints the console lines of ${file} from ${source === "this log" ? "it" : "them"}.`,
    );
    return lines;
  }
  const { lines: kept, total, limit } = log.console;
  if (total === 0) return [...lines, "", `Console of ${file} in ${source}: none`];
  const shown = total > kept.length ? `first ${limit} of ${total} lines` : plural(total, "line");
  return [
    ...lines,
    "",
    `Console of ${file} in ${source} (${shown}):`,
    ...kept.map((l) => `  ${l}`),
  ];
}

/** Issue 15 (011-04): why no run log is named. A report without the reason predates it. */
function gapText(gap: WhyRunLogGap | undefined): string {
  switch (gap) {
    case "no-state":
      return "this worktree has no known state of the check and holds no failure of it";
    case "no-origin":
      return "the known state names no origin";
    case "replaced":
      return "a later run replaced the result behind the known state at its key and no producing run is recorded";
    case "producer-pruned":
      return "the run that produced the known state has no run record left (pruned)";
    case "not-stored":
      return "no result is stored at this worktree's key (pruned)";
    case "unidentified":
      return "no stored result, or several, fit the known state";
    default:
      return "no stored result is identifiably the one behind the known state (replaced, pruned, or several fit)";
  }
}

function replacedHere(why: WhyReport, result: WhyResultEntry["result"]): boolean {
  const replaced = why.replacedAtKey;
  return replaced?.key === result.key && replaced.runId === result.provenance.runId;
}

function worktreeName(why: WhyReport, worktreeId: string): string {
  if (worktreeId === why.worktreeId) return `${why.worktreeRoot} (this worktree)`;
  return why.worktreeRoots[worktreeId] ?? `removed worktree ${worktreeId}`;
}

function producer(why: WhyReport, log: WhyRunLog): string {
  const root = why.worktreeRoots[log.worktreeId];
  if (log.worktreeId === why.worktreeId) return `${root ?? why.worktreeRoot} (this worktree)`;
  const other = root ?? `removed worktree ${log.worktreeId}`;
  return why.knownState?.origin?.kind === "inherited" ? `${other} (inherited)` : other;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function upper(outcome: KnownOutcome): string {
  return outcome.toUpperCase();
}
