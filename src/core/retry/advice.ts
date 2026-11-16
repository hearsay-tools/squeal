import { NO_EARLIER_PASS_TEXT } from "../state/flaky.js";
import { shellWord } from "../text.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { RecordedFacts } from "../types/status.js";
import { busyLoad, recordedWhereText, retryStateText } from "./text.js";

/*
 * Row 005-92 (research hook-messages-2026-11-16, finding 12): a registration
 * printed about 390 characters of retry advice per failure, 11 times in one
 * message. Each failure keeps its own facts in one short line; the advice
 * that rows 011-67 and 011-253 give (`recordedText`) is said once, after the
 * blocks. `squeal why` and status keep `recordedText` whole.
 */

/** Test files the advice's command names before it names them by a placeholder. */
const FILES_NAMED = 5;

/**
 * A known failure's facts in one line: when, where, the revision and the
 * load per CPU, that no pass is on record before it, and its retry.
 */
export function recordedShortText(facts: RecordedFacts, here: WorktreeId, now: EpochMs): string {
  const fresh = facts.noEarlierPass === true ? `; ${NO_EARLIER_PASS_TEXT} it` : "";
  return `${recordedWhereText(facts, here, now)}${fresh}; ${retryStateText(facts)}`;
}

/** A failure the advice may name: its facts and its test file as the command names it. */
export interface Advised {
  readonly facts: RecordedFacts;
  readonly path: string;
}

/**
 * The advice for a registration's failures, once, `null` when none applies:
 * where no pass is on record before a failure, its changed files first; for
 * those recorded at a busy load with no retry asked, the load retry that runs
 * their test files once more, after "if the changed files are not the cause"
 * when every one of them has no earlier pass.
 */
export function retryAdviceText(failures: readonly Advised[], command: string): string | null {
  const fresh = failures.some((f) => f.facts.noEarlierPass === true);
  const busy = failures.filter((f) => f.facts.retry === undefined && busyLoad(f.facts.loadPerCpu));
  const parts: string[] = [];
  if (fresh) {
    parts.push(`Where ${NO_EARLIER_PASS_TEXT} a failure, look first at the changed files it reads`);
  }
  if (busy.length > 0) {
    const files = [...new Set(busy.map((f) => f.path))];
    const named = files.length > FILES_NAMED ? "<test file>..." : files.map(shellWord).join(" ");
    const when = busy.every((f) => f.facts.noEarlierPass === true)
      ? "if the changed files are not the cause, "
      : "";
    const them = files.length === 1 ? "it" : "them";
    parts.push(
      `${when}\`${command} retry ${named} --reason load\` runs ${them} once more when the one-minute load average is below the CPU count`,
    );
  }
  if (parts.length === 0) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
