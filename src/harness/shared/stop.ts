import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../../core/daemon/policy.js";
import {
  formatDelta,
  formatRegistration,
  readHeader,
  readLiveHeader,
} from "../../core/delivery/index.js";
import { slowFiles } from "../../core/slow/index.js";
import { isFastPending, slowFilesNotCurrent, toKnownFailure } from "../../core/state/index.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../../core/status/index.js";
import { readTransaction, storePaths } from "../../core/store/index.js";
import type {
  EpochMs,
  KnownFailure,
  Policy,
  StatusHeader,
  TestFileRef,
} from "../../core/types/index.js";
import { removeWaiterLock } from "../../core/waiter-lock/index.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { ensureIfStale, startingAfter } from "./ensure.js";
import { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
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
 * what is left of the hook timeout, at most the usual hook busy timeout.
 * Review wave 3, N4: a full wait plus a full busy timeout outlasted the hook.
 */
export function stopBusyTimeoutMs(waitMs: number): number {
  return Math.min(STATUS_BUSY_TIMEOUT_MS, HOOK_TIMEOUT_MS - STOP_MARGIN_MS - waitMs);
}

/** What a Stop says: a block with its reason, news that keeps the turn going, or nothing. */
export type StopOutcome = { readonly block: string } | { readonly news: string } | null;

/**
 * Stop and SubagentStop (D9): wait up to `stop.waitMs` for the pending checks
 * of the current revision, deliver the delta with its status header, and
 * block with a factual reason when `stop.blockOnKnownFailures`,
 * `stop.requireFullSuite` or `stop.requireSlowSuite` (spec 004 D7: a slow
 * test file not current at this revision) is not met. Stop never waits for
 * slow files, whatever the policy (D9).
 *
 * Stop context is not passive: Claude Code continues the turn so the model
 * can read it (2.1.288 counts it toward its consecutive-block cap). So Stop
 * speaks only with news: a delta, a first registration with known failures,
 * or a block. A Stop that fires while an earlier one keeps the agent going
 * (`stopHookActive`) never blocks again, so a policy the agent cannot meet
 * cannot loop.
 *
 * Task 001-85: a main agent's Stop that says nothing ends the turn, so its
 * consumer is idle and the waiter may wake it for the test files pending now;
 * one that speaks keeps the turn going, and the Stop after it decides.
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
 * no registration still registers, as `newsText` says.
 */
export function stopTurn(
  input: ConsumerInput & { readonly stopHookActive: boolean },
  location: HookLocation,
  deps: HookDeps,
): Promise<StopOutcome> {
  const project = readPolicy(location.root);
  const policy = project.stop;
  const wait = Math.max(0, Math.min(policy.waitMs, STOP_WAIT_CAP_MS));
  return withContext<StopOutcome>(
    input,
    location,
    deps,
    async (context) => {
      if (input.agent_id !== undefined && !isRegistered(context)) return null;
      const at = (deps.now ?? Date.now)();
      const starting = startingAfter(await ensureIfStale(context, deps), at);
      const isSlow = slowFiles(project, project.nodeTest);
      if (wait > 0) {
        await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS, isSlow);
      }

      const { consumer } = context;
      const news = await newsText(context, starting, deps.command);
      const now = deps.now ?? Date.now;
      const blocking =
        !input.stopHookActive &&
        (policy.blockOnKnownFailures || policy.requireFullSuite || policy.requireSlowSuite);
      for (let decision = 1; ; decision++) {
        const { header, failures, reasons } = decide(context, policy, isSlow, now(), {
          stopHookActive: input.stopHookActive,
          command: deps.command,
        });
        if (reasons.length > 0) {
          const text = news ?? statusText(header, failures, deps.command);
          return { block: `${reasons.join("\n")}\n\n${text}` };
        }
        if (input.agent_id !== undefined) await finishSubagent(context);
        else if (news === null) {
          // The turn ends at the revision decided on; a newer one is decided again, up to a bound.
          const at = blocking ? { atRevision: header.revision } : {};
          if (!(await context.delivery.endTurn(consumer, at))) {
            if (decision < STOP_DECISIONS) continue;
            const text = statusText(header, failures, deps.command);
            return { block: `${retriesReason(header.revision)}\n\n${text}` };
          }
        }
        return news === null ? null : { news };
      }
    },
    { busyTimeoutMs: stopBusyTimeoutMs(wait) },
  );
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
}

/**
 * The block decision of `stop.blockOnKnownFailures`, `stop.requireFullSuite`
 * and `stop.requireSlowSuite` from one read transaction: states, keys and
 * header of one revision, so a slow file queued by a revision the states do
 * not show yet is never read as current (spec 004 D7, review wave 2 B3).
 */
function decide(
  context: HookContext,
  policy: Policy["stop"],
  isSlow: (testFile: TestFileRef) => boolean,
  now: number,
  {
    stopHookActive,
    command,
  }: { readonly stopHookActive: boolean; readonly command: string | undefined },
): Decision {
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
    const current = failures.filter((f) => f.validity === "current");
    const reasons: string[] = [];
    if (stopHookActive) return { header, failures, reasons };
    if (policy.blockOnKnownFailures && current.length > 0) {
      reasons.push(knownFailuresReason(header.revision, current, earlier(failures)));
    }
    if (policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
      reasons.push(fullSuiteReason(header, command));
    }
    if (policy.requireSlowSuite) {
      const open = slowFilesNotCurrent(states, keys, isSlow);
      if (open.length > 0) reasons.push(slowSuiteReason(header.revision, open, command));
    }
    return { header, failures, reasons };
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

/** SubagentStop: the subagent is done, so its consumer and view go (D9). */
async function finishSubagent(context: HookContext): Promise<void> {
  await context.delivery.unregister(context.consumer);
  removeWaiterLock(storePaths(context.commonDir).locksDir, context.consumer);
}

/**
 * The delta with its header and the known-failure count; for a main agent with
 * no registration, its registration when that lists known failures. `null`
 * when there is nothing new.
 */
async function newsText(
  context: HookContext,
  starting: { readonly startingSince?: EpochMs },
  command?: string,
): Promise<string | null> {
  const { store, delivery, consumer } = context;
  if (!isRegistered(context)) {
    const registration = await delivery.register(consumer, { inTurn: true, ...starting });
    return registration.knownFailures.length > 0
      ? formatRegistration(registration, undefined, command)
      : null;
  }
  // Task 001-224: news at Stop costs a continuation, so the edit line only rides on other news.
  const delta = await delivery.onToolBoundary(consumer, { stop: true });
  if (delta === null) return null;
  const failures = store.knownStates
    .list(consumer.worktreeId)
    .filter((s) => s.outcome === "fail")
    .map((s) => s.check);
  return `${formatDelta(delta, command)}\n${knownFailuresLine(failures, command)}`;
}

/**
 * Polls the header until nothing but slow test files is pending at the
 * current revision, the runner part of the revision included (review wave
 * 4.5, S1), or `waitMs` passed. Stop never waits for slow files (spec 004
 * D9); they stay in the idle snapshot `endTurn` writes. Each read is one read
 * transaction, so it never pairs a new revision with the previous revision's
 * states (lessons defect 23).
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
    const header = readTransaction(store, () =>
      readHeader(store, consumer.worktreeId, undefined, undefined, isSlow),
    );
    if (!isFastPending(header)) return;
    const left = deadline - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(pollMs, left));
  }
}
