import { setTimeout as sleep } from "node:timers/promises";
import { formatDelta, formatRegistration, readHeader } from "../../../core/delivery/index.js";
import { toKnownFailure } from "../../../core/state/index.js";
import type { HookContext } from "../context.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";
import { readHookPolicy } from "../policy.js";
import { fullSuiteReason, knownFailuresLine, knownFailuresReason, statusText } from "../text.js";

/**
 * The longest `stop.waitMs` honoured. Every hook has `timeout: 2` (D9); Node
 * start and the store reads need the rest of the 2 s, and a hook killed by its
 * timeout delivers nothing.
 */
export const STOP_WAIT_CAP_MS = 1_500;

/** How often Stop re-reads the header while it waits for pending checks. */
export const STOP_POLL_MS = 100;

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
 */
export const stop: Handler = (input, location, deps) =>
  withContext(input, location, deps, async (context) => {
    const policy = readHookPolicy(location.root).stop;
    const wait = Math.min(policy.waitMs, STOP_WAIT_CAP_MS);
    if (wait > 0) await waitForPending(context, wait, deps.pollIntervalMs ?? STOP_POLL_MS);

    const { store, consumer } = context;
    const news = await newsText(context);
    const states = store.knownStates.list(consumer.worktreeId);
    const header = readHeader(store, consumer.worktreeId, states);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);

    const reasons: string[] = [];
    if (input.stop_hook_active !== true) {
      if (policy.blockOnKnownFailures && failures.length > 0) {
        reasons.push(knownFailuresReason(header.revision, failures));
      }
      if (policy.requireFullSuite && !header.fullSuite.atCurrentRevision) {
        reasons.push(fullSuiteReason(header));
      }
    }
    if (reasons.length > 0) {
      const text = news ?? statusText(consumer, header, failures.length);
      return { output: { decision: "block", reason: `${reasons.join("\n")}\n\n${text}` } };
    }
    return news === null ? null : additionalContext(input, news);
  });

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
