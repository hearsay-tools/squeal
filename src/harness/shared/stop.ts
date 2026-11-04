import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../../core/daemon/client.js";
import { readPolicy } from "../../core/daemon/policy.js";
import {
  formatDelta,
  formatRegistration,
  markLeaving,
  readHeader,
  worktreeLiveness,
} from "../../core/delivery/index.js";
import { countStopHold } from "../../core/delivery/turn.js";
import { slowView } from "../../core/scheduler/slow.js";
import type { StopWaitHarness } from "../../core/slow/index.js";
import { isFastPending } from "../../core/state/index.js";
import { readHolds, STATUS_BUSY_TIMEOUT_MS } from "../../core/status/index.js";
import { readTransaction, storePaths } from "../../core/store/index.js";
import {
  type EpochMs,
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
import {
  decide,
  holdsNow,
  STOP_RECORD_WAIT_MS,
  type StopRules,
  stopRules,
  waitingEntryRecorded,
} from "./stop-decide.js";
import { knownFailuresLine, statusText } from "./text.js";

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
 * another session in the worktree runs. Both entries start together, so
 * before the turn's first such hold this one waits up to
 * `STOP_RECORD_WAIT_MS` from its start for that record
 * (`waitingEntryRecorded`, row 019-30), and does so before it prepares its
 * news (`holdsNow`, row 019-36): the news's writes stay in a transaction
 * open until the hand-off, the record cannot land while it is open, and so
 * a first Stop with news held at once (lessons P10). Neither holds a main
 * agent whose worktree had no revision since it registered
 * (`unchangedSinceRegistration`, task 004-67); a SubagentStop still blocks.
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
      const recordBy = performance.now() + STOP_RECORD_WAIT_MS;
      const at = (deps.now ?? Date.now)();
      // Task 001-416: before the wait, so a SubagentStop its timeout kills still ends the registration.
      if (!main) leaving(context, at);
      const starting = quiet ? {} : startingAfter(await ensureIfStale(context, deps), at);
      if (wait > 0) {
        const isGroupFile = slowView(project).isSlow;
        await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS, isGroupFile);
      }
      const rules = {
        read: () => stopRules(context, project, input, deps),
        recorded: () => waitingEntryRecorded(context, input.harness, deps, recordBy),
      };
      // Row 019-36: the news's prepared writes would keep the record from landing in the wait.
      if (!quiet && holdsNow(context, rules.read())) await rules.recorded();
      const news = quiet ? null : await newsText(context, starting, deps.command);
      return decideTurn(context, project, news, rules, deps);
    },
    // Row 019-30: the wait for the waiting entry's record overlaps the wait for pending checks.
    { busyTimeoutMs: stopBusyTimeoutMs(Math.max(wait, STOP_RECORD_WAIT_MS)) },
  );
}

/**
 * How a Stop reads its rules (`stopRules`), and waits for its waiting
 * entry's record before a hold that record would leave to that entry
 * (`waitingEntryRecorded`, row 019-30).
 */
interface TurnRules {
  readonly read: () => StopRules;
  readonly recorded: () => Promise<boolean>;
}

/**
 * Decides and ends the turn: a block, `news`, or silence after `endTurn`.
 * A main agent's turn ends at the revision decided on; a newer one is
 * decided again, up to `STOP_DECISIONS`. A hold for required checks first
 * waits for the waiting entry's record; once it came, the rules are read
 * again and that entry decides (row 019-30, lessons P3).
 */
async function decideTurn(
  context: HookContext,
  project: Policy,
  news: string | null,
  turnRules: TurnRules,
  deps: HookDeps,
): Promise<StopOutcome> {
  const { consumer } = context;
  const main = consumer.agentId === MAIN_AGENT;
  const now = deps.now ?? Date.now;
  let rules = turnRules.read();
  for (let decision = 1; ; decision++) {
    let decided = decide(context, project, now(), rules, deps.command);
    if (decided.held && (await turnRules.recorded())) {
      rules = turnRules.read();
      decided = decide(context, project, now(), rules, deps.command);
    }
    const { header, failures, reasons, held } = decided;
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
 * With a `checks` key, the files pending in any group lane (`lanePending`,
 * spec 019 D3): the nudge reaches every lane, so a group at `pause` or
 * `stop` starts now too (row 019-23).
 */
async function nudgeSlow(context: HookContext, header: StatusHeader): Promise<void> {
  const pending = header.lanePending ?? header.slowPending;
  if ((pending?.testFiles ?? 0) === 0) return;
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
