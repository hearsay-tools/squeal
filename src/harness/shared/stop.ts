import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../../core/daemon/client.js";
import { readPolicy } from "../../core/daemon/policy.js";
import { squealVersion } from "../../core/daemon/version.js";
import {
  formatDelta,
  formatRegistration,
  markLeaving,
  readHeader,
  readLiveHeader,
  worktreeLiveness,
} from "../../core/delivery/index.js";
import { countStopHold, readStopHolds } from "../../core/delivery/turn.js";
import { slowView } from "../../core/scheduler/slow.js";
import { type StopWaitHarness, stopWaitRuns } from "../../core/slow/index.js";
import {
  isFastPending,
  requiredNotCurrent,
  type StopRequired,
  stopRequired,
  toKnownFailure,
} from "../../core/state/index.js";
import { readHolds, STATUS_BUSY_TIMEOUT_MS } from "../../core/status/index.js";
import { readTransaction, storePaths } from "../../core/store/index.js";
import {
  type EpochMs,
  type KnownFailure,
  MAIN_AGENT,
  type Policy,
  type RevisionNumber,
  type StatusHeader,
  type TestFileRef,
} from "../../core/types/index.js";
import { removeWaiterLock } from "../../core/waiter-lock/index.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { ensureIfStale, SOCKET_TIMEOUT_MS, startingAfter } from "./ensure.js";
import { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
import { unchangedSinceRegistration } from "./no-edit.js";
import { codeStopReason } from "./stop-code.js";
import { lintStopReasons } from "./stop-lint.js";
import {
  fullSuiteReason,
  knownFailuresLine,
  knownFailuresReason,
  slowSuiteReason,
  statusText,
} from "./text.js";

/**
 * The longest `stop.waitMs` honoured. Every hook has `timeout: 2` (D9); Node
 * start and the store reads need the rest of the 2 s, and a hook killed by its
 * timeout delivers nothing.
 */
export const STOP_WAIT_CAP_MS = 1_500;

/** Node start (about 50 ms) and the store reads around the wait. */
export const STOP_MARGIN_MS = 250;

/** How often Stop re-reads the header while it waits for pending checks. */
export const STOP_POLL_MS = 100;

/**
 * How long Stop's store statements wait for a lock after waiting `waitMs`:
 * what is left of the hook timeout after the nudge's socket budget
 * (`nudgeSlow`), at most the usual hook busy timeout. Review wave 3, N4: a
 * full wait plus a full busy timeout outlasted the hook.
 */
export function stopBusyTimeoutMs(waitMs: number): number {
  const left = HOOK_TIMEOUT_MS - STOP_MARGIN_MS - SOCKET_TIMEOUT_MS - waitMs;
  return Math.min(STATUS_BUSY_TIMEOUT_MS, left);
}

/** What a Stop says: a block with its reason, news that keeps the turn going, or nothing. */
export type StopOutcome = { readonly block: string } | { readonly news: string } | null;

/**
 * Stop and SubagentStop (D9): wait up to `stop.waitMs` for the pending checks
 * of the current revision, deliver the delta with its status header, and
 * block with a factual reason when `stop.blockOnKnownFailures`,
 * `stop.requireFullSuite` or a check Stop requires (`stopRequired`: spec 004
 * D7's slow files under `stop.requireSlowSuite`, 019 D4's groups at `stop`)
 * is not met. This entry never waits for the files of a group lane (019 D3;
 * slow files, D9), whatever the policy. A main agent's required checks are
 * the waiting entry's (`stopSlow`, D9 as amended 2026-10-12) once its
 * harness's waiting entry is known to run for this session at this version
 * (`stopWaitRuns`, task 001-297); until then this one blocks on them as
 * before, so an untrusted or missing waiting hook still holds, whatever
 * another session in the worktree runs. Neither holds a main agent whose
 * worktree had no revision since it registered (`unchangedSinceRegistration`,
 * task 004-67); a SubagentStop still blocks.
 *
 * Stop context is not passive: Claude Code continues the turn so the model
 * can read it (2.1.288 counts it toward its consecutive-block cap). So Stop
 * speaks only with news: a delta, a first registration with known failures,
 * or a block. A Stop that fires while an earlier one keeps the agent going
 * (`stopHookActive`) never blocks again for another policy, so a policy the
 * agent cannot meet cannot loop. The required checks are the exception
 * (spec 019 D4 step 3, row 019-14): a main agent is held for them while the
 * holds Squeal counts this turn (`readStopHolds`) are fewer than
 * `stop.maxHolds`, and each such block counts one; a SubagentStop keeps
 * `stopHookActive` for them too (004 D7, one hold). `quiet` is Codex's Stop
 * with `stop_hook_active`, where news is a block that would continue the
 * turn again: no ensure, no wait and no news, only a hold for required
 * checks or the turn's end, handed to the waiting entry.
 *
 * Task 001-85: a main agent's Stop that says nothing ends the turn, so its
 * consumer is idle and the waiter may wake it for the test files pending now;
 * one that speaks keeps the turn going, and the Stop after it decides. With
 * slow files pending, the silent Stop then nudges the daemon (`nudgeSlow`).
 *
 * `stop.blockOnKnownFailures` blocks only on failures current at this
 * revision; failures whose re-run is pending are named as such, never as
 * existing (review wave 3, S1). A subagent that stops without a block can
 * receive nothing more, so SubagentStop unregisters its consumer after
 * delivering (S6).
 *
 * Review wave 6, S2: a SubagentStop whose consumer has no registration is a
 * fork's. A real subagent is registered by SubagentStart or, if that hook
 * failed, by its first tool boundary, so one that arrives unregistered ran no
 * tool and has nothing to act on. Such a SubagentStop registers nothing,
 * ensures no daemon, never blocks and says nothing. A main agent's Stop with
 * no registration still registers, as `newsText` says, unless `quiet`.
 */
export function stopTurn(
  input: ConsumerInput & {
    readonly stopHookActive: boolean;
    readonly harness: StopWaitHarness;
    readonly quiet?: boolean;
  },
  location: HookLocation,
  deps: HookDeps,
): Promise<StopOutcome> {
  const project = readPolicy(location.root);
  const quiet = input.quiet === true;
  const wait = quiet ? 0 : Math.max(0, Math.min(project.stop.waitMs, STOP_WAIT_CAP_MS));
  const main = input.agent_id === undefined;
  return withContext<StopOutcome>(
    input,
    location,
    deps,
    async (context) => {
      if ((!main || quiet) && !isRegistered(context)) return null;
      const at = (deps.now ?? Date.now)();
      // Task 001-416: before the wait, so a SubagentStop its timeout kills still ends the registration.
      if (!main) leaving(context, at);
      const starting = quiet ? {} : startingAfter(await ensureIfStale(context, deps), at);
      if (wait > 0) {
        const isGroupFile = slowView(project).isSlow;
        await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS, isGroupFile);
      }
      const news = quiet ? null : await newsText(context, starting, deps.command);
      return decideTurn(context, project, news, stopRules(context, project, input, deps), deps);
    },
    { busyTimeoutMs: stopBusyTimeoutMs(wait) },
  );
}

/** What one Stop may block for, read once before its decisions. */
interface StopRules {
  readonly stopHookActive: boolean;
  /** The checks Stop requires when this entry decides them and may hold for them; else `null`. */
  readonly required: StopRequired | null;
  /** Some policy may block: the turn ends only at the revision a decision read (004 D7). */
  readonly blocking: boolean;
  /** Stop requires checks: the turn's end is handed to the waiting entry (task 001-295). */
  readonly handoff: boolean;
}

/**
 * The rules of one Stop. Spec 019 D4 step 3: a main agent is held for the
 * checks Stop requires while its turn has holds left, counted by Squeal; a
 * subagent while `stop_hook_active` is off (004 D7). Task 001-297: a main
 * agent's required checks are the waiting entry's once it is known to run
 * for this session at this version.
 */
function stopRules(
  context: HookContext,
  project: Policy,
  input: { readonly stopHookActive: boolean; readonly harness: StopWaitHarness },
  deps: HookDeps,
): StopRules {
  const { store, consumer } = context;
  const { stopHookActive } = input;
  const required = stopRequired(project);
  const main = consumer.agentId === MAIN_AGENT;
  const holdsLeft =
    required !== null &&
    (main ? readStopHolds(store, consumer) < required.maxHolds : !stopHookActive);
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
  };
}

/**
 * Decides and ends the turn: a block, `news`, or silence after `endTurn`.
 * A main agent's turn ends at the revision decided on; a newer one is
 * decided again, up to `STOP_DECISIONS`.
 */
async function decideTurn(
  context: HookContext,
  project: Policy,
  news: string | null,
  rules: StopRules,
  deps: HookDeps,
): Promise<StopOutcome> {
  const { consumer } = context;
  const main = consumer.agentId === MAIN_AGENT;
  const now = deps.now ?? Date.now;
  for (let decision = 1; ; decision++) {
    const { header, failures, reasons, held } = decide(
      context,
      project,
      now(),
      rules,
      deps.command,
    );
    if (reasons.length > 0) {
      if (!main) leaving(context, null);
      else if (held) hold(context);
      const text = news ?? statusText(header, failures, deps.command);
      return { block: `${reasons.join("\n")}\n\n${text}` };
    }
    if (!main) await finishSubagent(context);
    else if (news === null) {
      const at = {
        ...(rules.blocking ? { atRevision: header.revision } : {}),
        // Task 001-295: what the waiting entry beside this one waits for.
        ...(rules.handoff ? { handoff: true } : {}),
      };
      if (!(await context.delivery.endTurn(consumer, at))) {
        if (decision < STOP_DECISIONS) continue;
        // A hold for required checks never decided current: counted, so it cannot loop.
        if (rules.required !== null) hold(context);
        const text = statusText(header, failures, deps.command);
        return { block: `${retriesReason(header.revision)}\n\n${text}` };
      }
      await nudgeSlow(context, header);
    }
    return news === null ? null : { news };
  }
}

/** Counts a hold of the main agent for required checks (spec 019 D4 step 3). */
function hold(context: HookContext): void {
  context.store.transaction(() => countStopHold(context.store, context.consumer));
}

/**
 * How many times Stop decides when a new revision keeps coming between its
 * decision and `endTurn`. Past it a blocking policy blocks: the turn never
 * ends at a revision no decision checked (review wave 2.5, B2), and the next
 * Stop, with `stop_hook_active`, ends it without blocking again.
 */
export const STOP_DECISIONS = 3;

/** The block at `STOP_DECISIONS`: `decided` is the revision the last decision read. */
function retriesReason(decided: number): string {
  return `Squeal: the revision changed ${STOP_DECISIONS} times while Stop decided, now past revision ${decided}; stop again to decide at the newest.`;
}

/** What a Stop decision read: the header, every known failure and the reasons to block. */
interface Decision {
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
function decide(
  context: HookContext,
  project: Policy,
  now: number,
  { stopHookActive, required }: Pick<StopRules, "stopHookActive" | "required">,
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
      const files = open.map((file) => file.ref);
      reasons.push(slowSuiteReason(header.revision, files, command));
    }
    if (stopHookActive) return { header, failures, reasons, held };
    const code = codeStopReason(context, project.complexity, command);
    if (code !== null) reasons.push(code);
    // Spec 017 D8: with lint.blocking, the files gone to fail lint since registration.
    reasons.push(...lintStopReasons(context, command));
    return { header, failures, reasons, held };
  });
}

/**
 * The SubagentStop of a harness's internal fork: a fork registers nothing, so
 * this unregisters only a consumer an older build registered for its agent
 * id; no daemon ensure, no output.
 */
export async function stopFork(
  input: ConsumerInput,
  location: HookLocation,
  deps: HookDeps,
): Promise<void> {
  await withContext(input, location, deps, async (context) => {
    if (isRegistered(context)) await finishSubagent(context);
    return null;
  });
}

/** Failures not observed at this revision: their re-run is pending, or they have no current result. */
function earlier(failures: readonly KnownFailure[]): readonly KnownFailure[] {
  return failures.filter((f) => f.validity !== "current");
}

/**
 * Marks the stopping subagent's consumer leaving at `at`, or clears the mark
 * when a block keeps it going (task 001-416). The daemon drops a consumer
 * whose mark outlives `LEAVING_GRACE_MS`; the normal end unregisters it.
 */
function leaving(context: HookContext, at: EpochMs | null): void {
  context.store.transaction(() => {
    if (isRegistered(context)) markLeaving(context.store, context.consumer, at);
  });
}

/** SubagentStop: the subagent is done, so its consumer and view go (D9). */
async function finishSubagent(context: HookContext): Promise<void> {
  await context.delivery.unregister(context.consumer);
  removeWaiterLock(storePaths(context.commonDir).locksDir, context.consumer);
}

/**
 * The delta with its header and the known-failure count; for a main agent with
 * no registration, its registration when that lists known failures. `null`
 * when there is nothing new, or with `atRevision` when the latest revision
 * is another one, which then delivers nothing (task 001-295).
 */
export async function newsText(
  context: HookContext,
  starting: { readonly startingSince?: EpochMs },
  command?: string,
  atRevision?: RevisionNumber,
): Promise<string | null> {
  const { store, delivery, consumer } = context;
  if (!isRegistered(context)) {
    const registration = await delivery.register(consumer, { inTurn: true, ...starting });
    return registration.knownFailures.length > 0
      ? formatRegistration(registration, undefined, command)
      : null;
  }
  // Task 001-224: news at Stop costs a continuation, so the edit line only rides on other news.
  const delta = await delivery.onToolBoundary(consumer, {
    stop: true,
    ...(atRevision === undefined ? {} : { atRevision }),
  });
  if (delta === null) return null;
  const failures = store.knownStates.list(consumer.worktreeId).filter((s) => s.outcome === "fail");
  // Task 001-407: Stop keeps the full header block.
  return `${formatDelta(delta, command, undefined, "full")}\n${knownFailuresLine(failures, command, delta.header)}`;
}

/**
 * Task 001-281: after a silent Stop ended the turn with slow files pending,
 * a nudge over the daemon's socket (D9: "liveness and nudges with a 100 ms
 * timeout"), so a slow tier waiting for its consumers to go idle starts now
 * rather than at its recheck (`SLOW_RECHECK_MS`). A daemon that does not
 * answer costs the socket budget and nothing more; the recheck still comes.
 */
async function nudgeSlow(context: HookContext, header: StatusHeader): Promise<void> {
  if ((header.slowPending?.testFiles ?? 0) === 0) return;
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  if (record === null) return;
  await requestDaemon(record.socketPath, { type: "nudge" }, SOCKET_TIMEOUT_MS).catch(() => {});
}

/**
 * Polls the header until nothing but slow test files is pending at the
 * current revision, the runner part of the revision included (review wave
 * 4.5, S1), or `waitMs` passed. Stop never waits for slow files (spec 004
 * D9); they stay in the idle snapshot `endTurn` writes. Each read is one read
 * transaction, so it never pairs a new revision with the previous revision's
 * states (lessons defect 23). Row 011-73 (C6 as amended 2026-10-21): it does
 * not wait while the worktree is on hold, since no tier starts then; the
 * waiter's idle wake takes the pending files' results after the hold.
 */
async function waitForPending(
  context: HookContext,
  waitMs: number,
  pollMs: number,
  isSlow: (testFile: TestFileRef) => boolean,
) {
  const deadline = performance.now() + waitMs;
  for (;;) {
    const { store, consumer } = context;
    const { header, held } = readTransaction(store, () => {
      const worktree = store.worktrees.get(consumer.worktreeId);
      const now = Date.now();
      return {
        header: readHeader(store, consumer.worktreeId, undefined, undefined, isSlow),
        held: readHolds(store, worktree, worktreeLiveness(worktree, now), now).length > 0,
      };
    });
    if (!isFastPending(header) || held) return;
    const left = deadline - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(pollMs, left));
  }
}
