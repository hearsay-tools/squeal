import { shellWord, timeText } from "../text.js";
import type { EpochMs, RecordedFacts, RetryFact, WorktreeId } from "../types/index.js";
import { type HostLoad, loadAllows } from "./load.js";
import type { RetryOutcome, RetryReason } from "./records.js";

/*
 * The words `squeal retry`, status and delivery use for a retry (001-368),
 * one source so the agent reads the same phrase everywhere. Factual, never
 * imperative (spec 001 D6).
 */

/** "load average 12.40 on 8 CPUs", or that it is not known. */
export function loadText(load: HostLoad): string {
  const cpus = `${load.cpus} ${load.cpus === 1 ? "CPU" : "CPUs"}`;
  return load.oneMinute === null
    ? `load average not known on ${cpus}`
    : `load average ${load.oneMinute.toFixed(2)} on ${cpus}`;
}

/**
 * What a pending request of `reason` waits for, with the load now; row
 * 011-27 (gh-41's comment): a `load` one the load lets run says it runs at
 * the daemon's next look, and one whose run is open since when.
 */
export function waitsText(
  reason: RetryReason,
  load: HostLoad,
  runningSince: EpochMs | null = null,
): string {
  if (runningSince !== null) return `running since ${timeText(runningSince)}`;
  if (reason === "environment") return "runs at once";
  if (load.oneMinute === null) return `runs at the daemon's next look (${loadText(load)})`;
  if (loadAllows(load)) {
    return `runs at the daemon's next look: the one-minute load average is below the CPU count (${loadText(load)} now)`;
  }
  return `waits for the one-minute load average to fall below the CPU count (${loadText(load)} now)`;
}

/** How an ended request ended, as a short phrase. */
export function outcomeText(outcome: RetryOutcome): string {
  switch (outcome) {
    case "passed":
      return "it passed";
    case "failed":
      return "it failed again";
    case "unknown":
      return "its run gave no result";
    case "cancelled":
      return "it was withdrawn";
  }
}

/** "retry asked (load) at these inputs: it passed", or "…, pending" while it waits. */
export function retryText(fact: RetryFact): string {
  const asked = `retry asked (${fact.reason}) at these inputs`;
  return fact.outcome === "pending"
    ? `${asked}, pending`
    : `${asked}: ${outcomeText(fact.outcome)}`;
}

/**
 * How long ago a run recorded a result (001-404): "just now" under a
 * minute, then minutes, hours and days, so an old failure reads as old.
 */
export function agoText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * A known failure whose producing result no stored row identifiably is
 * (review 001-417 B3): `KnownFailure.recordedUnknown`.
 */
export const RECORDED_UNKNOWN_TEXT =
  "recorded at an unknown time and load: the result that produced it is no longer identifiable in the store";

/** How a printed command names the CLI and a failure's test file. */
export interface RetryCommandWords {
  /** The CLI as the surface names it (`SQUEAL_COMMAND`, or the Codex command). */
  readonly command: string;
  /** The test file from the reader's directory, unquoted: the text makes it one shell word. */
  readonly path: string;
}

/** The load per CPU a failure's run had, as a known failure states it (001-368). */
export function loadPerCpuText(loadPerCpu: number | null): string {
  return loadPerCpu === null
    ? "load per CPU then not recorded"
    : `load ${loadPerCpu.toFixed(2)} per CPU when it ran`;
}

/**
 * A known failure's facts at registration, in status and in `why` (spec 001
 * D6, 001-368, 001-404): how long ago, where and at which revision it was
 * recorded, the load per CPU then, and the retry. A failure recorded at a
 * load a `load` retry would wait out, with no retry asked, names that retry
 * in `words` (row 011-67, gh-52); it stays counted, and nothing is queued.
 */
export function recordedText(
  facts: RecordedFacts,
  here: WorktreeId,
  now: EpochMs,
  words: RetryCommandWords,
): string {
  const where =
    facts.worktreeId === here
      ? "this worktree"
      : (facts.worktreeRoot ?? `worktree ${facts.worktreeId}`);
  const ago = facts.recordedAt === undefined ? "" : ` ${agoText(now - facts.recordedAt)}`;
  const retry =
    facts.retry === undefined
      ? `no retry asked at these inputs${loadRetryText(facts.loadPerCpu, words)}`
      : retryText(facts.retry);
  return `recorded${ago} in ${where} at revision ${facts.revision}, ${loadPerCpuText(facts.loadPerCpu)}; ${retry}`;
}

/**
 * `; \`squeal retry <file> --reason load\` runs it once more …` for a run at
 * or above the threshold a `load` retry waits on (`loadAllows`, one CPU's
 * share), else empty. The path is one shell word, quoted only when it needs
 * it (review 0.1.271 S1); the command stays as the surface formats it.
 */
function loadRetryText(loadPerCpu: number | null, words: RetryCommandWords): string {
  if (loadPerCpu === null || loadAllows({ oneMinute: loadPerCpu, cpus: 1 })) return "";
  return `; \`${words.command} retry ${shellWord(words.path)} --reason load\` runs it once more when the one-minute load average is below the CPU count`;
}
