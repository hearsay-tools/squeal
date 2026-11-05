import { setTimeout as sleep } from "node:timers/promises";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { readStopHolds } from "../../core/delivery/turn.js";
import { type StopWaitHarness, stopWaitRuns } from "../../core/slow/index.js";
import {
  openGroups,
  type RequiredFile,
  requiredNotCurrent,
  type StopRequired,
  stopRequired,
  toKnownFailure,
} from "../../core/state/index.js";
import { type RequiredLint, requiredLintOpen } from "../../core/state/required.js";
import { readTransaction } from "../../core/store/index.js";
import {
  type KnownFailure,
  type KnownState,
  MAIN_AGENT,
  type Policy,
  type StatusHeader,
  type TestFileKeyRecord,
} from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import { type HookDeps, isRegistered } from "./hook.js";
import { unchangedSinceRegistration } from "./no-edit.js";
import { codeStopReason } from "./stop-code.js";
import {
  lintOpenReason,
  lintSourceOf,
  lintStopReasons,
  requiredLintBlocking,
} from "./stop-lint.js";
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
  /**
   * Review 0.1.406 B2: the lint groups Stop requires, `null` with none;
   * `holds` while this Stop may hold for them, `last` when such a hold
   * spends the main agent's last one this turn.
   */
  readonly lint: {
    readonly required: StopRequired;
    readonly holds: boolean;
    readonly last: boolean;
  } | null;
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
  const holds = budget(context, required, stopHookActive);
  const lint = required !== null && required.lintGroups.length > 0 ? required : null;
  const version = deps.squealVersion ?? squealVersion();
  const elsewhere = main && stopWaitRuns(store, consumer, input.harness, version);
  const decides = holds.left && !elsewhere;
  const others = othersBlock(project);
  return {
    stopHookActive,
    required: decides ? required : null,
    blocking:
      decides ||
      (lint !== null && holds.left) ||
      (!stopHookActive && (others || required !== null)),
    handoff: required !== null,
    lastHold: decides && holds.last,
    lint: lint === null ? null : { required: lint, holds: holds.left, last: holds.last },
  };
}

/**
 * Whether a Stop may hold for `required` (019 D4 step 3): a main agent
 * while its turn has holds left, `last` when one now spends the last of
 * them; a subagent while `stop_hook_active` is off (004 D7).
 */
function budget(
  { store, consumer }: HookContext,
  required: StopRequired | null,
  stopHookActive: boolean,
): { readonly left: boolean; readonly last: boolean } {
  if (required === null) return { left: false, last: false };
  if (consumer.agentId !== MAIN_AGENT) return { left: !stopHookActive, last: false };
  const holds = readStopHolds(store, consumer);
  const last = required.groupTexts && holds + 1 >= required.maxHolds;
  return { left: holds < required.maxHolds, last };
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
 * checks Stop requires (`decide`'s `held`), from one read transaction, so it
 * can wait for the waiting entry's record (`waitingEntryRecorded`) before it
 * prepares its news: that news's writes stay in a transaction open until the
 * hand-off (row 011-288), and the record is a write that cannot land until
 * then. `false` for a consumer with no registration: it registers with its
 * news, and the waiting entry records only a registered one.
 */
export function holdsNow(context: HookContext, { required }: Pick<StopRules, "required">): boolean {
  if (required === null || !isRegistered(context)) return false;
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const open = heldFor(context, required, states, keys);
    return open.tests.length > 0 || open.lint.length > 0;
  });
}

/** The required checks a Stop holds for: test files not current, and lint checks not linted (row 019-45). */
interface HeldFor {
  readonly tests: readonly RequiredFile[];
  readonly lint: readonly RequiredLint[];
}

const NONE: HeldFor = { tests: [], lint: [] };

/**
 * The required checks a Stop holds for: those not current, none for a main
 * agent whose worktree has had no revision since it registered (task
 * 004-67). Call inside a transaction.
 */
function heldFor(
  context: HookContext,
  required: StopRequired | null,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): HeldFor {
  if (required === null) return NONE;
  const { store, consumer } = context;
  if (consumer.agentId === MAIN_AGENT && unchangedSinceRegistration(store, consumer)) return NONE;
  return {
    tests: requiredNotCurrent(states, keys, required),
    lint: requiredLintOpen(lintSourceOf(context), consumer.worktreeId, required),
  };
}

/**
 * Review 0.1.406 B2 (spec 019 D1, D4 step 3; 017 D8): with `lint.blocking`,
 * the files of the lint groups Stop requires gone to fail, once none of
 * their checks waits to lint. Nothing is left to wait for, so this entry
 * holds for them whether or not the waiting entry runs, and the hold counts
 * in the turn's holds as the waiting entry's does: one decision, one budget.
 * Empty while a hold is not allowed or a required lint check waits (the
 * waiting entry, or this entry's hold for open checks, decides then).
 */
function lintFailing(
  context: HookContext,
  lint: StopRules["lint"],
  command: string | undefined,
): readonly string[] {
  if (lint === null || !lint.holds) return [];
  const { store, consumer } = context;
  if (consumer.agentId === MAIN_AGENT && unchangedSinceRegistration(store, consumer)) return [];
  const reasons = requiredLintBlocking(context, lint.required, command);
  if (reasons.length === 0) return [];
  const open = requiredLintOpen(lintSourceOf(context), consumer.worktreeId, lint.required);
  return open.length === 0 ? reasons : [];
}

/**
 * The hold's reason for `open` and the required lint failures (`failing`),
 * a line per group, tests' first; `null` with neither. With `last` it says
 * it is the turn's last hold.
 */
function heldReason(
  open: HeldFor,
  failing: { readonly reasons: readonly string[]; readonly groups: readonly string[] },
  revision: number,
  command: string | undefined,
  last: boolean,
): string | null {
  const tests = open.tests.length === 0 ? [] : [requiredSuiteReason(revision, open.tests, command)];
  const lint = open.lint.length === 0 ? [] : [lintOpenReason(revision, open.lint, command)];
  const lines = [...tests, ...lint, ...failing.reasons];
  if (lines.length === 0) return null;
  const groups = [
    ...new Set([...openGroups(open.tests), ...open.lint.map((c) => c.group), ...failing.groups]),
  ];
  return withLastHold(lines.join("\n"), groups, command, last);
}

/** What a Stop decision read: the header, every known failure and the reasons to block. */
export interface Decision {
  readonly header: StatusHeader;
  readonly failures: readonly KnownFailure[];
  readonly reasons: readonly string[];
  /**
   * A reason is a required check not current, or a required lint failure
   * (review 0.1.406 B2): the block is a hold (spec 019 D4 step 3).
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
 * `stopHookActive`, only `required`, which `stopRules` gives only while this
 * entry may hold for it, and the required lint failures (`lintFailing`).
 * The `lint.blocking` reason of other policy (`lintStopReasons`) leaves out
 * the tools of the lint groups Stop requires: their failures are a hold.
 */
export function decide(
  context: HookContext,
  project: Policy,
  now: number,
  {
    stopHookActive,
    required,
    lastHold,
    lint: requiredLint,
  }: Pick<StopRules, "stopHookActive" | "required" | "lastHold" | "lint">,
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
    const open = heldFor(context, required, states, keys);
    const failing = lintFailing(context, requiredLint, command);
    const failingGroups = failing.length === 0 ? [] : (requiredLint?.required.lintGroups ?? []);
    const last = lastHold || (failing.length > 0 && requiredLint?.last === true);
    const reason = heldReason(
      open,
      { reasons: failing, groups: failingGroups },
      header.revision,
      command,
      last,
    );
    const held = reason !== null;
    const decision = { header, failures, reasons, held };
    if (held) reasons.push(reason);
    if (stopHookActive) return decision;
    const code = codeStopReason(context, project.complexity, command);
    if (code !== null) reasons.push(code);
    // Spec 017 D8: with lint.blocking, the files gone to fail lint since registration.
    reasons.push(...lintStopReasons(context, command, requiredLint?.required ?? null));
    return decision;
  });
}

/** Failures not observed at this revision: their re-run is pending, or they have no current result. */
function earlier(failures: readonly KnownFailure[]): readonly KnownFailure[] {
  return failures.filter((f) => f.validity !== "current");
}
