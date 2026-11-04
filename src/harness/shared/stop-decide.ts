import { setTimeout as sleep } from "node:timers/promises";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { readStopHolds } from "../../core/delivery/turn.js";
import { type StopWaitHarness, stopWaitRuns } from "../../core/slow/index.js";
import {
  openGroups,
  requiredNotCurrent,
  type StopRequired,
  stopRequired,
  toKnownFailure,
} from "../../core/state/index.js";
import { readTransaction } from "../../core/store/index.js";
import {
  type KnownFailure,
  MAIN_AGENT,
  type Policy,
  type StatusHeader,
} from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import type { HookDeps } from "./hook.js";
import { unchangedSinceRegistration } from "./no-edit.js";
import { codeStopReason } from "./stop-code.js";
import { lintStopReasons } from "./stop-lint.js";
import { requiredSuiteReason, withLastHold } from "./stop-text.js";
import { fullSuiteReason, knownFailuresReason } from "./text.js";

/*
 * What the 2 s Stop entry (`stopTurn`) blocks for: its rules, read once per
 * Stop, and one decision from one read transaction. Moved out of `stop.ts`
 * by row 019-14.
 */

/** What one Stop may block for, read once before its decisions. */
export interface StopRules {
  readonly stopHookActive: boolean;
  /** The checks Stop requires when this entry decides them and may hold for them; else `null`. */
  readonly required: StopRequired | null;
  /** Some policy may block: the turn ends only at the revision a decision read (004 D7). */
  readonly blocking: boolean;
  /** Stop requires checks: the turn's end is handed to the waiting entry (task 001-295). */
  readonly handoff: boolean;
  /**
   * Row 019-30 (lessons P6): with a `checks` key, a hold for `required` now
   * spends the main agent's last one this turn, and its reason says so.
   */
  readonly lastHold: boolean;
}

/**
 * The rules of one Stop. Spec 019 D4 step 3: a main agent is held for the
 * checks Stop requires while its turn has holds left, counted by Squeal; a
 * subagent while `stop_hook_active` is off (004 D7). Task 001-297: a main
 * agent's required checks are the waiting entry's once it is known to run
 * for this session at this version.
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
  const holds = main ? readStopHolds(store, consumer) : 0;
  const holdsLeft = required !== null && (main ? holds < required.maxHolds : !stopHookActive);
  const version = deps.squealVersion ?? squealVersion();
  const elsewhere = main && stopWaitRuns(store, consumer, input.harness, version);
  const decides = holdsLeft && !elsewhere;
  const policy = project.stop;
  const others =
    policy.blockOnKnownFailures ||
    policy.requireFullSuite ||
    // Spec 015 D7.
    (project.complexity.enabled && project.complexity.blocking);
  return {
    stopHookActive,
    required: decides ? required : null,
    blocking: decides || (!stopHookActive && (others || required !== null)),
    handoff: required !== null,
    lastHold: decides && main && required.groupTexts && holds + 1 >= required.maxHolds,
  };
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
    const left = deadline - performance.now();
    if (left <= 0) return false;
    await sleep(Math.min(STOP_RECORD_POLL_MS, left));
  }
}

/** What a Stop decision read: the header, every known failure and the reasons to block. */
export interface Decision {
  readonly header: StatusHeader;
  readonly failures: readonly KnownFailure[];
  readonly reasons: readonly string[];
  /** A reason is a required check not current: the block is a hold (spec 019 D4 step 3). */
  readonly held: boolean;
}

/**
 * The block decision of `stop.blockOnKnownFailures`, `stop.requireFullSuite`
 * and the checks Stop requires from one read transaction: states, keys and
 * header of one revision, so a required file queued by a revision the
 * states do not show yet is never read as current (spec 004 D7, review wave
 * 2 B3). With `complexity.blocking`, the functions gone over since
 * registration too (spec 015 D7), from the code store. With
 * `stopHookActive`, only `required`, which `stopRules` gives only while this
 * entry may hold for it.
 */
export function decide(
  context: HookContext,
  project: Policy,
  now: number,
  {
    stopHookActive,
    required,
    lastHold,
  }: Pick<StopRules, "stopHookActive" | "required" | "lastHold">,
  command: string | undefined,
): Decision {
  const { store, consumer } = context;
  const policy = project.stop;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
    const current = failures.filter((f) => f.validity === "current");
    const reasons: string[] = [];
    if (!stopHookActive && policy.blockOnKnownFailures && current.length > 0) {
      reasons.push(knownFailuresReason(header.revision, current, earlier(failures)));
    }
    if (!stopHookActive && policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
      reasons.push(fullSuiteReason(header, command));
    }
    // Task 004-67: a main agent whose worktree has no revision since it registered is not held.
    const unchanged =
      consumer.agentId === MAIN_AGENT && unchangedSinceRegistration(store, consumer);
    const open = required === null || unchanged ? [] : requiredNotCurrent(states, keys, required);
    const held = open.length > 0;
    if (held) {
      const reason = requiredSuiteReason(header.revision, open, command);
      reasons.push(withLastHold(reason, openGroups(open), command, lastHold));
    }
    if (stopHookActive) return { header, failures, reasons, held };
    const code = codeStopReason(context, project.complexity, command);
    if (code !== null) reasons.push(code);
    // Spec 017 D8: with lint.blocking, the files gone to fail lint since registration.
    reasons.push(...lintStopReasons(context, command));
    return { header, failures, reasons, held };
  });
}

/** Failures not observed at this revision: their re-run is pending, or they have no current result. */
function earlier(failures: readonly KnownFailure[]): readonly KnownFailure[] {
  return failures.filter((f) => f.validity !== "current");
}
