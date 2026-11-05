import { setTimeout as sleep } from "node:timers/promises";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { readStopHolds } from "../../core/delivery/turn.js";
import { type StopWaitHarness, stopWaitRuns } from "../../core/slow/index.js";
import { type StopRequired, stopRequired, toKnownFailure } from "../../core/state/index.js";
import { readTransaction } from "../../core/store/index.js";
import {
  type EpochMs,
  type KnownFailure,
  MAIN_AGENT,
  type Policy,
  type StatusHeader,
} from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import { type HookDeps, isRegistered } from "./hook.js";
import { codeStopReason } from "./stop-code.js";
import { lintStopReasons } from "./stop-lint.js";
import { type RequiredRead, requiredStep, stepReason } from "./stop-required.js";
import { fullSuiteReason, knownFailuresReason } from "./text.js";

/*
 * What the 2 s Stop entry (`stopTurn`) blocks for: its rules, read once per
 * Stop, and one decision from one read transaction. Moved out of `stop.ts`
 * by row 019-14.
 */

/** What one Stop may block for, read once before its decisions. */
export interface StopRules {
  readonly stopHookActive: boolean;
  /**
   * The checks Stop requires when this entry decides their open checks and
   * may hold for them (no waiting entry known to run); else `null`.
   */
  readonly required: StopRequired | null;
  /** Some policy may block: the turn ends only at the revision a decision read (004 D7). */
  readonly blocking: boolean;
  /** Stop requires checks: the turn's end is handed to the waiting entry (task 001-295). */
  readonly handoff: boolean;
  /**
   * Review 0.1.406-r2 B2-R1: the checks Stop requires while this Stop may
   * hold for them, whichever entry decides their open checks; `null`
   * otherwise. Row 019-30 (lessons P6): `last` when a hold now spends the
   * main agent's last one this turn, and its reason says so. Once none of
   * them is open, this entry holds for their `lint.blocking` failures
   * (`requiredStep`) whether or not the waiting entry runs.
   */
  readonly holds: { readonly required: StopRequired; readonly last: boolean } | null;
}

/**
 * The rules of one Stop. Spec 019 D4 step 3: a main agent is held for the
 * checks Stop requires while its turn has holds left, counted by Squeal; a
 * subagent while `stop_hook_active` is off (004 D7). Task 001-297: a main
 * agent's open required checks are the waiting entry's once it is known to
 * run for this session at this version.
 */
export function stopRules(
  context: HookContext,
  project: Policy,
  input: { readonly stopHookActive: boolean; readonly harness: StopWaitHarness },
  deps: HookDeps,
): StopRules {
  const { store, consumer } = context;
  const { stopHookActive } = input;
  const required = stopRequired(project);
  const main = consumer.agentId === MAIN_AGENT;
  const holds = budget(context, required, stopHookActive);
  const version = deps.squealVersion ?? squealVersion();
  const elsewhere = main && stopWaitRuns(store, consumer, input.harness, version);
  const decides = holds !== null && !elsewhere;
  const others = othersBlock(project);
  // A lint group Stop requires may fail `lint.blocking`, which this entry holds for itself.
  const failing = holds !== null && holds.required.lintGroups.length > 0;
  return {
    stopHookActive,
    required: decides ? required : null,
    blocking: decides || failing || (!stopHookActive && (others || required !== null)),
    handoff: required !== null,
    holds,
  };
}

/**
 * The checks `required` while a Stop may hold for them (019 D4 step 3): a
 * main agent's while its turn has holds left, `last` when one now spends
 * the last of them; a subagent's while `stop_hook_active` is off (004 D7).
 * `null` with none or no hold left.
 */
function budget(
  { store, consumer }: HookContext,
  required: StopRequired | null,
  stopHookActive: boolean,
): StopRules["holds"] {
  if (required === null) return null;
  if (consumer.agentId !== MAIN_AGENT) return stopHookActive ? null : { required, last: false };
  const holds = readStopHolds(store, consumer);
  if (holds >= required.maxHolds) return null;
  return { required, last: required.groupTexts && holds + 1 >= required.maxHolds };
}

/** A policy beside the required checks may block: known failures, the full suite, complexity (015 D7). */
function othersBlock(project: Policy): boolean {
  const policy = project.stop;
  return (
    policy.blockOnKnownFailures ||
    policy.requireFullSuite ||
    (project.complexity.enabled && project.complexity.blocking)
  );
}

/**
 * Row 019-30 (lessons P3): how long the 2 s entry waits at most, from its
 * start, for its harness's waiting entry to record that it runs for the
 * session, before a hold that record would leave to that entry.
 */
export const STOP_RECORD_WAIT_MS = 500;

/** How often it reads that record meanwhile: one slot of one row. */
const STOP_RECORD_POLL_MS = 25;

/**
 * Row 019-30 (lessons P3): the harness starts both Stop entries at once, and
 * until the waiting entry records that it runs for this session
 * (`recordStopWait`, at its start), this entry decides the required checks
 * itself and holds at once, with no wait, and that hold counts. So before a
 * main agent's first hold of its turn for them, in a harness with a waiting
 * entry (Claude Code, Codex), this entry waits until `deadline`
 * (`performance.now()`) for that record: `true` when it came, and the
 * waiting entry decides. Without it by then the waiting entry does not run
 * for this session (untrusted, removed, or slower than that), and this entry
 * holds as before; a later hold of the turn does not wait again.
 */
export async function waitingEntryRecorded(
  context: HookContext,
  harness: StopWaitHarness,
  deps: HookDeps,
  deadline: number,
): Promise<boolean> {
  const { store, consumer } = context;
  if (harness === "pi" || consumer.agentId !== MAIN_AGENT) return false;
  if (readStopHolds(store, consumer) > 0) return false;
  const version = deps.squealVersion ?? squealVersion();
  for (;;) {
    if (readTransaction(store, () => stopWaitRuns(store, consumer, harness, version))) return true;
    // Row 019-36: a prepared report holds the write lock, so the record cannot come meanwhile.
    if (context.prepared?.pending === true) return false;
    const left = deadline - performance.now();
    if (left <= 0) return false;
    await sleep(Math.min(STOP_RECORD_POLL_MS, left));
  }
}

/**
 * Row 019-36 (lessons P10): whether this entry would hold now for the
 * checks Stop requires that are open (`requiredStep`), from one read
 * transaction, so it can wait for the waiting entry's record
 * (`waitingEntryRecorded`) before it prepares its news: that news's writes
 * stay in a transaction open until the hand-off (row 011-288), and the
 * record is a write that cannot land until then. A hold for their failures
 * comes whether or not that record comes. `false` for a consumer with no
 * registration: it registers with its news, and the waiting entry records
 * only a registered one.
 */
export function holdsNow(
  context: HookContext,
  { required }: Pick<StopRules, "required">,
  now: EpochMs = Date.now(),
): boolean {
  if (required === null || !isRegistered(context)) return false;
  return readTransaction(context.store, () => {
    const read = readRequired(context, now);
    const step = requiredStep(context, required, read, {
      untold: null,
      at: now,
      command: undefined,
    });
    return step?.kind === "open";
  });
}

/** One read of the checks Stop requires and the known failures, inside a transaction. */
function readRequired(
  { store, consumer }: HookContext,
  now: EpochMs,
): RequiredRead & { readonly failures: readonly KnownFailure[] } {
  const states = store.knownStates.list(consumer.worktreeId);
  const keys = store.testFileKeys.list(consumer.worktreeId);
  const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
  const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
  const current = failures.filter((f) => f.validity === "current");
  return { states, keys, header, failures, current };
}

/**
 * The reason of this entry's hold for the checks Stop requires, `null` for
 * none (review 0.1.406-r2 B2-R1, one owner: `requiredStep`). While one is
 * open, a hold naming them when this entry decides them (`required`), else
 * none: the waiting entry asks for them and waits. Once none is open, the
 * hold for their `lint.blocking` failures, whether or not the waiting entry
 * runs: nothing is left to wait for, and the hold counts in the turn's
 * holds as the waiting entry's does.
 */
function heldReason(
  context: HookContext,
  { required, holds }: Pick<StopRules, "required" | "holds">,
  read: RequiredRead,
  at: EpochMs,
  command: string | undefined,
): string | null {
  if (holds === null) return null;
  const step = requiredStep(context, holds.required, read, { untold: null, at, command });
  if (step === null || (step.kind === "open" && required === null)) return null;
  return stepReason(step, holds.required, read, { command, last: holds.last });
}

/** What a Stop decision read: the header, every known failure and the reasons to block. */
export interface Decision {
  readonly header: StatusHeader;
  readonly failures: readonly KnownFailure[];
  readonly reasons: readonly string[];
  /**
   * A reason is a required check open, or a required lint failure (review
   * 0.1.406 B2): the block is a hold (spec 019 D4 step 3).
   */
  readonly held: boolean;
}

/**
 * The block decision of `stop.blockOnKnownFailures`, `stop.requireFullSuite`
 * and the checks Stop requires from one read transaction: states, keys and
 * header of one revision, so a required file queued by a revision the
 * states do not show yet is never read as current (spec 004 D7, review wave
 * 2 B3). With `complexity.blocking`, the functions gone over since
 * registration too (spec 015 D7), from the code store. With
 * `stopHookActive`, only the hold for the checks Stop requires, which
 * `stopRules` allows only while this entry may hold for them
 * (`heldReason`). The `lint.blocking` reason of other policy
 * (`lintStopReasons`) leaves out the tools of the lint groups Stop
 * requires: their failures are a hold.
 */
export function decide(
  context: HookContext,
  project: Policy,
  now: EpochMs,
  rules: Pick<StopRules, "stopHookActive" | "required" | "holds">,
  command: string | undefined,
): Decision {
  const { store } = context;
  const policy = project.stop;
  const { stopHookActive } = rules;
  return readTransaction(store, () => {
    const read = readRequired(context, now);
    const { header, failures, current } = read;
    const reasons: string[] = [];
    if (!stopHookActive && policy.blockOnKnownFailures && current.length > 0) {
      reasons.push(knownFailuresReason(header.revision, current, earlier(failures)));
    }
    if (!stopHookActive && policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
      reasons.push(fullSuiteReason(header, command));
    }
    const reason = heldReason(context, rules, read, now, command);
    const held = reason !== null;
    const decision = { header, failures, reasons, held };
    if (held) reasons.push(reason);
    if (stopHookActive) return decision;
    const code = codeStopReason(context, project.complexity, command);
    if (code !== null) reasons.push(code);
    // Spec 017 D8: with lint.blocking, the files gone to fail lint since registration.
    reasons.push(...lintStopReasons(context, command, stopRequired(project)));
    return decision;
  });
}

/** Failures not observed at this revision: their re-run is pending, or they have no current result. */
function earlier(failures: readonly KnownFailure[]): readonly KnownFailure[] {
  return failures.filter((f) => f.validity !== "current");
}
