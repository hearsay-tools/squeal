import { NO_EARLIER_PASS_TEXT } from "../state/flaky.js";
import { durationText, shellWord, timeText } from "../text.js";
import type { EpochMs, RecordedFacts, RetryFact, RetryWait, WorktreeId } from "../types/index.js";
import { LOAD_RETRY_WAIT_MS, loadRetryDue } from "./gate.js";
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

/** How long a `load` request has waited, rounded down: it does not read "10 min" before its bound. */
function waitedText(ms: number): string {
  return durationText(ms, Math.floor);
}

/** The most a `load` retry waits for the load gate, as the texts name it. */
const BOUND_TEXT = waitedText(LOAD_RETRY_WAIT_MS);

/**
 * How long a `load` request has met the gate closed (row 011-213): since
 * when a daemon at its key first did, `null` while none has, and the time now.
 * For several files, `since` is the oldest file's time and `latest` the
 * newest's (review 0.1.328 B1).
 */
export interface GateWait {
  readonly since: EpochMs | null;
  readonly latest?: EpochMs;
  readonly now: EpochMs;
}

/**
 * What a pending request of `reason` that no daemon has queued yet waits
 * for, with the load now; row 011-27 (gh-41's comment): a `load` one the
 * load lets through says the daemon queues it at its next look. Row
 * 011-213: a `load` one the load holds says how long the gate has been
 * closed of the most it waits, and once that has passed, that the daemon
 * queues it at its next look. Row 011-272 (gh-114): queued is not started,
 * so none says it runs now.
 */
export function waitsText(
  reason: RetryReason,
  load: HostLoad,
  gate: GateWait | null = null,
): string {
  const next = "the daemon queues its run at its next look";
  if (reason === "environment") return next;
  if (load.oneMinute === null) return `${next} (${loadText(load)})`;
  if (loadAllows(load)) {
    return `${next}: the one-minute load average is below the CPU count (${loadText(load)} now)`;
  }
  const waits = "waits for the one-minute load average to fall below the CPU count";
  // No daemon at its key met the gate closed yet, or a released one, which keeps no time (B1).
  if (gate === null || gate.since === null) return `${waits} (${loadText(load)} now)`;
  const oldest = waitedText(gate.now - gate.since);
  if (loadRetryDue(gate.since, gate.now)) {
    return `${next}: the one-minute load average stayed at or above the CPU count for ${BOUND_TEXT}, the most a load retry waits (${loadText(load)} now)`;
  }
  const newest = waitedText(gate.now - (gate.latest ?? gate.since));
  if (newest !== oldest) {
    return `${waits}: at or above it for ${newest} to ${oldest}, by file, of at most ${BOUND_TEXT}, then each runs once anyway (${loadText(load)} now)`;
  }
  return `${waits}: at or above it for ${oldest} of at most ${BOUND_TEXT}, then runs once anyway (${loadText(load)} now)`;
}

/** When an `environment` retry, or a `load` one the load lets through, runs (row 011-272). */
export const IN_TURN_TEXT = "runs once more in its turn at its normal priority";

/**
 * When a `load` retry asked now runs (row 011-213), as `squeal retry`
 * answers: in its turn once the load is below the CPU count, or at the
 * bound. Row 011-272: never "now", which its queue need not give it.
 */
export function loadRetryWhenText(load: HostLoad): string {
  return loadAllows(load)
    ? `${IN_TURN_TEXT}: the one-minute load average is below the CPU count (${loadText(load)})`
    : `runs once more when the one-minute load average falls below the CPU count, or after at most ${BOUND_TEXT} above it, then with a load note (${loadText(load)} now)`;
}

/**
 * Row 011-272 (gh-114): what holds a queued run that has not started, after
 * "it has not started" or "queued and not started": `: fast work goes first
 * (a run open since 12:00:03)`, or `; what holds it is not known`.
 */
export function holdText(wait: Exclude<RetryWait, { kind: "running" }>): string {
  switch (wait.kind) {
    case "tier":
      return `: the tier of its lane runs first, since ${timeText(wait.since)}`;
    case "fast":
      return wait.since === null
        ? ": fast work goes first"
        : `: fast work goes first (a run open since ${timeText(wait.since)})`;
    case "slow":
      return `: the slow tier runs other files, since ${timeText(wait.since)}`;
    case "slot":
      return ": the slow tier waits for the slow slot";
    case "load":
      return ": the slow tier waits for the host load to drop";
    case "idle":
      return ": the slow tier waits for the agent to pause";
    case "unknown":
      return "; what holds it is not known";
  }
}

/**
 * Where a retry's run stands once asked (row 011-272), as `squeal retry`
 * says it: a run of the file open at its inputs, or not started and why.
 */
export function retryStartText(wait: RetryWait): string {
  return wait.kind === "running"
    ? `a run of it at these inputs is running since ${timeText(wait.since)}`
    : `it has not started${holdText(wait)}`;
}

/**
 * The daemon's note when the bound queued a `load` retry while the gate
 * stayed closed (row 011-213), as 004 D3's note for a slow file under load.
 */
export function loadRetryNoteText(path: string, loadPerCpu: number): string {
  return `load retry of ${path} queued under load ${loadPerCpu.toFixed(2)} per CPU, at or above one per CPU, once it had waited ${BOUND_TEXT} for the one-minute load average to fall below the CPU count (spec 011 C5)`;
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
 * Row 011-253 (gh-103): one with no pass at its key on record before it leads
 * with that and the changed files it reads; its load retry comes last, for
 * when they are not the cause (a key is new after any edit a test reads).
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
  const fresh = facts.noEarlierPass === true;
  const retry =
    facts.retry === undefined
      ? `no retry asked at these inputs${loadRetryText(facts.loadPerCpu, words, fresh)}`
      : retryText(facts.retry);
  const lead = fresh
    ? `${NO_EARLIER_PASS_TEXT} this failure: look first at the changed files it reads; `
    : "";
  return `${lead}recorded${ago} in ${where} at revision ${facts.revision}, ${loadPerCpuText(facts.loadPerCpu)}; ${retry}`;
}

/**
 * `; \`squeal retry <file> --reason load\` runs it once more …` for a run at
 * or above the threshold a `load` retry waits on (`loadAllows`, one CPU's
 * share), else empty. The path is one shell word, quoted only when it needs
 * it (review 0.1.271 S1); the command stays as the surface formats it. After
 * the changed files' lead (`fresh`, row 011-253) it is for when they are not
 * the cause.
 */
function loadRetryText(
  loadPerCpu: number | null,
  words: RetryCommandWords,
  fresh: boolean,
): string {
  if (loadPerCpu === null || loadAllows({ oneMinute: loadPerCpu, cpus: 1 })) return "";
  const when = fresh ? "if the changed files are not the cause, " : "";
  return `; ${when}\`${words.command} retry ${shellWord(words.path)} --reason load\` runs it once more when the one-minute load average is below the CPU count`;
}
