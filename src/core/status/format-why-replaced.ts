import { causeText } from "../state/index.js";
import type { CheckError, WhyReplacedFailure, WhyReport, WorktreeId } from "../types/index.js";
import { shortCommit } from "./format-status.js";
import { loadText } from "./replaced-failures.js";

/** The indent of a result's lines under its head. */
export const INDENT = "        ";

/** Each error's stack or head, its code and the causes a stack does not print (001-361), its diff. */
export function errorLines(errors: readonly CheckError[]): string[] {
  return errors.flatMap((error) => {
    const head = error.stack ?? `${error.name}: ${error.message}`;
    const text = [
      head,
      error.code === undefined || head.includes(error.code) ? null : `code: ${error.code}`,
      ...(error.causes ?? []).map((cause) => `Caused by: ${causeText(cause)}`),
      error.diff,
    ]
      .filter((part) => part !== null)
      .join("\n");
    return text.split("\n").map((line) => `${INDENT}${line}`);
  });
}

/** A worktree as `why` names it: this one, another's root, or a removed one's id. */
export function worktreeName(why: WhyReport, worktreeId: WorktreeId): string {
  if (worktreeId === why.worktreeId) return `${why.worktreeRoot} (this worktree)`;
  return why.worktreeRoots[worktreeId] ?? `removed worktree ${worktreeId}`;
}

/**
 * 011 C6 as amended 2026-10-21 (row 011-77, gh-54): the check's replaced
 * failures, each with its run, its log or that it was pruned, and its errors
 * from its kept text or that the text was pruned. Never a stale path: a run
 * record gone names no log.
 */
export function replacedLines(why: WhyReport): string[] {
  const kept = why.replacedFailures ?? [];
  if (kept.length === 0) return [];
  return [
    "",
    `Replaced failures (${kept.length}, newest first):`,
    ...kept.flatMap((entry) => entryLines(why, entry)),
  ];
}

function entryLines(why: WhyReport, { failure, logDir, errors }: WhyReplacedFailure): string[] {
  const p = failure.provenance;
  const by = failure.replacedBy;
  const lines = [
    `  REPLACED  ${new Date(p.recordedAt).toISOString()}  ${worktreeName(why, p.worktreeId)}, revision ${p.revision}, commit ${shortCommit(p.commit)}, ${p.dirty ? "dirty" : "clean"}`,
    `${INDENT}run ${p.runId}, ${Math.round(failure.durationMs)} ms, key ${failure.key.slice(0, 12)}, ${loadText(failure.loadPerCpu)}`,
    `${INDENT}replaced by PASS ${new Date(by.recordedAt).toISOString()} (${worktreeName(why, by.worktreeId)}, run ${by.runId})`,
    `${INDENT}log: ${logDir ?? "run record pruned"}`,
  ];
  if (failure.summary !== null) lines.push(`${INDENT}${failure.summary}`);
  if (errors === null) lines.push(`${INDENT}failure text pruned: its errors and stack are gone`);
  else lines.push(...errorLines(errors));
  return lines;
}

/** Whether a kept replaced failure is at `key`, so the flaky note's replaced FAIL is listed with it. */
export function replacedAt(why: WhyReport, key: string): boolean {
  return (why.replacedFailures ?? []).some((entry) => entry.failure.key === key);
}
