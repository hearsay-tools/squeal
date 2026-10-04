import { setTimeout as sleep } from "node:timers/promises";
import {
  formatDelta,
  formatRegistration,
  readHeader,
  readLiveHeader,
} from "../../../core/delivery/index.js";
import { toKnownFailure } from "../../../core/state/index.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../../../core/status/index.js";
import { storePaths } from "../../../core/store/index.js";
import type { KnownFailure } from "../../../core/types/index.js";
import type { HookContext } from "../context.js";
import { ensureIfStale } from "../ensure.js";
import {
  additionalContext,
  type Handler,
  HOOK_TIMEOUT_MS,
  isRegistered,
  withContext,
} from "../hook.js";
import { readHookPolicy } from "../policy.js";
import { fullSuiteReason, knownFailuresLine, knownFailuresReason, statusText } from "../text.js";
import { removeWaiterLock } from "../waiter-lock.js";

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

/**
 * Stop and SubagentStop (D9): wait up to `stop.waitMs` for the pending checks
 * of the current revision, deliver the delta with its status header, and
 * block with a factual reason when `stop.blockOnKnownFailures` or
 * `stop.requireFullSuite` is not met.
 *
 * Stop context is not passive: Claude Code continues the turn so the model
 * can read it (2.1.288 counts it toward its consecutive-block cap). So Stop
 * speaks only with news: a delta, a first registration with known failures,
 * or a block. A Stop that fires while an earlier one keeps the agent going
 * (`stop_hook_active`) never blocks again, so a policy the agent cannot meet
 * cannot loop.
 *
 * `stop.blockOnKnownFailures` blocks only on failures current at this
 * revision; failures whose re-run is pending are named as such, never as
 * existing (review wave 3, S1). A subagent that stops without a block can
 * receive nothing more, so SubagentStop unregisters its consumer after
 * delivering (S6).
 */
export const stop: Handler = (input, location, deps) => {
  const policy = readHookPolicy(location.root).stop;
  const wait = Math.max(0, Math.min(policy.waitMs, STOP_WAIT_CAP_MS));
  return withContext(
    input,
    location,
    deps,
    async (context) => {
      await ensureIfStale(context, deps);
      if (wait > 0) await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS);

      const { store, consumer } = context;
      const news = await newsText(context);
      const states = store.knownStates.list(consumer.worktreeId);
      const header = readLiveHeader(store, consumer.worktreeId, (deps.now ?? Date.now)(), states);
      const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
      const current = failures.filter((f) => f.validity === "current");

      const reasons: string[] = [];
      if (input.stop_hook_active !== true) {
        if (policy.blockOnKnownFailures && current.length > 0) {
          reasons.push(knownFailuresReason(header.revision, current, earlier(failures)));
        }
        if (policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
          reasons.push(fullSuiteReason(header));
        }
      }
      if (reasons.length > 0) {
        const text = news ?? statusText(consumer, header, failures.length);
        return { output: { decision: "block", reason: `${reasons.join("\n")}\n\n${text}` } };
      }
      if (input.agent_id !== undefined) await finishSubagent(context);
      return news === null ? null : additionalContext(input, news);
    },
    { busyTimeoutMs: stopBusyTimeoutMs(wait) },
  );
};

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
 * The delta with its header and the known-failure count; for a consumer with
 * no registration, its registration when that lists known failures. `null`
 * when there is nothing new.
 */
async function newsText(context: HookContext): Promise<string | null> {
  const { store, delivery, consumer } = context;
  if (!isRegistered(context)) {
    const registration = await delivery.register(consumer);
    return registration.knownFailures.length > 0 ? formatRegistration(registration) : null;
  }
  const delta = await delivery.onToolBoundary(consumer);
  if (delta === null) return null;
  const failures = store.knownStates
    .list(consumer.worktreeId)
    .filter((s) => s.outcome === "fail").length;
  return `${formatDelta(delta)}\n${knownFailuresLine(failures)}`;
}

/** Polls the header until nothing is pending at the current revision or `waitMs` passed. */
async function waitForPending(context: HookContext, waitMs: number, pollMs: number) {
  const deadline = performance.now() + waitMs;
  for (;;) {
    const header = readHeader(context.store, context.consumer.worktreeId);
    if (header.counts.pending + header.testFilesWithoutChecks.pending === 0) return;
    const left = deadline - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(pollMs, left));
  }
}
