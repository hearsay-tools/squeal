import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../../core/daemon/policy.js";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/liveness.js";
import { countStopHold, readStopHolds, readTurn, startTurn } from "../../core/delivery/turn.js";
import { recordStopWait, requestGroups, type StopWaitHarness } from "../../core/slow/stop-wait.js";
import { toKnownFailure } from "../../core/state/header.js";
import { type StopRequired, stopRequired } from "../../core/state/required.js";
import { readTransaction } from "../../core/store/store.js";
import type { EpochMs } from "../../core/types/common.js";
import type { KnownFailure, StatusHeader } from "../../core/types/status.js";
import { HOOK_TIMEOUT_MS } from "../../core/types/store-records.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { readTree, unchangedSinceRegistration } from "./no-edit.js";
import { newsText } from "./stop.js";
import {
  isOpen,
  openGroupsOf,
  type RequiredOpen,
  type RequiredRead,
  requiredOpen,
  requiredStep,
  stepReason,
  stoppedByRequest,
} from "./stop-required.js";
import { statusText } from "./text.js";

/**
 * The waiting Stop entry's `timeout` in both plugins' hooks.json, seconds:
 * above `STOP_SLOW_WAIT_CAP_MS` plus the handoff, so the bound, not the
 * harness, ends the wait. Spec 019 D4 step 2: an hour. Claude Code acted on
 * a Stop hook's block after 1900 s, and Codex sets no maximum
 * (`stop-wait.md` 2); a new value makes Codex users trust the hook again.
 */
export const STOP_SLOW_HOOK_TIMEOUT_S = 3_600;

/**
 * How long the waiting entry waits for the 2 s Stop entry beside it to end
 * the turn: that entry's whole hook timeout and a second more.
 */
export const STOP_SLOW_HANDOFF_MS = HOOK_TIMEOUT_MS + 1_000;

/**
 * How long before this entry's process started the 2 s entry may have ended
 * the turn: the harness starts both entries at once, and one that started
 * first ran at most its hook timeout.
 */
export const STOP_SLOW_HANDOFF_SLACK_MS = HOOK_TIMEOUT_MS;

/** A daemon down this long while Stop waits will not run the slow files; the wait ends. */
export const STOP_SLOW_DOWN_MS = 10_000;

/** How often the waiting entry re-reads the store. */
export const STOP_SLOW_POLL_MS = 250;

/**
 * The waiting Stop entry (spec 004 D9 as amended 2026-10-12, 019 D4): while
 * a group Stop waits for has checks (`stopRequired`: the default `slow`
 * group under `stop.requireSlowSuite`, every group at `stop`), a main
 * agent's Stop waits up to `stop.slowWaitMs` for them to become current, and
 * returns a block reason or `null`.
 *
 * Claude Code and Codex run a Stop event's entries in parallel, so this one
 * decides only after the 2 s entry (`stopTurn`) ended the turn silently: it
 * waits up to `STOP_SLOW_HANDOFF_MS` for that (`handedOver`). A 2 s entry
 * that blocked or spoke leaves the turn going, and this entry says nothing;
 * one that ended the turn leaves the decision here, so the two never both
 * block. It first records that it runs for this session (`recordStopWait`);
 * from then on the session's 2 s entry leaves the open required checks to
 * it, and before that blocks on them at once as it always did, which leaves
 * this entry silent. Both entries decide by one owner, `requiredStep`
 * (review 0.1.406-r2 B2-R1): no hold for a required failure while a
 * required check is open.
 *
 * Spec 019 D4 step 3: it may hold the agent `stop.maxHolds` times in one
 * turn, counted by Squeal per consumer from the user's prompt
 * (`readStopHolds`, `countStopHold`), never by the harness's
 * `stop_hook_active`. So a Stop after
 * any other Squeal message (a fast failure, a block of another policy) still
 * waits while holds remain (`stop-wait.md` C2), and so does one after more
 * edits (C3). With none left it returns `null` at once.
 *
 * Spec 019 D4 step 1: once a required group has a check that is not
 * current (a test file, or a lint check not linted), it asks the daemon to
 * run that group now (`requestGroups`), each group once; a runner part still
 * pending with no such file asks nothing (review 0.1.395, S1). The request's
 * socket time is part of the wait (S2).
 *
 * A session that changed nothing (`unchangedSinceRegistration`, task
 * 004-67, issue 19; row 011-312: with Git read once after the handoff,
 * `readTree`) is not held, and this entry returns `null` once the handoff
 * came, without waiting.
 *
 * Then it polls until no required check is open (`requiredOpen`: no test
 * file pending or not run, the runner part of the revision applied, no lint
 * check waiting to lint), the bound passes, the daemon is stopped by request
 * (`stoppedByRequest`, row 011-312: no daemon runs them, so open checks hold
 * nothing and it returns at once), or the daemon has been down for
 * `STOP_SLOW_DOWN_MS`, and decides from a
 * read in a write transaction (`decide`, review wave 13am B2): what a poll
 * saw may be a snapshot the daemon has moved past, and the decision holds
 * only for the live revision. Not complete before the bound: it polls
 * again, within the same bound. Not complete at the bound: a block naming
 * the open checks and a pending runner part. Complete: a block naming each
 * required check that is a current failure this session was not told
 * (`requiredStep`), at whatever revision or key it ran, and the lint
 * groups' untold findings and `lint.blocking` failures; with none, `null`, and the
 * turn ends as today. Task 001-305 (the human, after review waves 13am,
 * 13an and 13ap): it keeps no list of the files it owes, which each review
 * found a narrower race past; a failure told before the turn ended, or the
 * same failure at a newer key, never blocks. Row 019-30, with a `checks`
 * key: the bound's block names the groups a group follows that keep its
 * files from starting (`pendingBefore`), and the block that spends the
 * turn's last hold says so (`stepReason`).
 *
 * A block takes the turn and counts a hold in that transaction, with the
 * check that the consumer is still idle: Claude Code's idle waiter may have
 * woken the agent meanwhile, or a prompt arrived, and then this entry says
 * nothing. Its news is delivered only at the decided revision, else its text
 * is the decided read's header, so a reason never sits beside a newer
 * header. A SubagentStop and a policy with no required group return `null`
 * at once.
 */
export async function stopSlow(
  input: ConsumerInput & { readonly harness: StopWaitHarness },
  location: HookLocation,
  deps: HookDeps,
): Promise<string | null> {
  if (input.agent_id !== undefined) return null;
  const required = stopRequired(readPolicy(location.root));
  if (required === null) return null;
  const poll = deps.pollIntervalMs ?? STOP_SLOW_POLL_MS;
  return withContext(input, location, deps, async (context) => {
    const version = deps.squealVersion ?? squealVersion();
    recordStopWait(context.store, context.consumer, input.harness, version);
    const { store, consumer } = context;
    if (readStopHolds(store, consumer) >= required.maxHolds) return null;
    if (!(await handedOver(context, deps, poll))) return null;
    await readTree(context);
    if (readTransaction(store, () => unchangedSinceRegistration(context))) return null;
    const block = await waitForRequired(context, required, deps, poll);
    if (block === null) return null;
    const { header, failures, reason } = block;
    const news = await newsText(context, {}, deps.command, header.revision);
    return `${reason}\n\n${news ?? statusText(header, failures, deps.command)}`;
  });
}

/** What one read of the store says about the required checks, the turn and the daemon. */
interface WaitRead extends RequiredRead {
  readonly failures: readonly KnownFailure[];
  /** The required checks open: test files, the runner part and lint checks (`requiredOpen`). */
  readonly open: RequiredOpen;
  readonly idle: boolean;
}

/** One read transaction; `clock` is read after the states and keys, inside it. */
function read(context: HookContext, required: StopRequired, clock: () => EpochMs): WaitRead {
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, clock(), states, null, keys);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
    return {
      states,
      keys,
      header,
      failures,
      current: failures.filter((f) => f.validity === "current"),
      open: requiredOpen(context, required, { states, keys, header }),
      idle: readTurn(store, consumer).turn === "idle",
    };
  });
}

/**
 * Whether the 2 s entry ended the turn: the consumer is idle with a
 * `StopHandoff` written since this entry's process started, less
 * `STOP_SLOW_HANDOFF_SLACK_MS`. Only that entry's silent end writes one, in
 * the transaction that makes the consumer idle, so an idle consumer without
 * a fresh one is idle from before, and this entry waits for the 2 s entry,
 * which may not have started. `false` when none came within
 * `STOP_SLOW_HANDOFF_MS`.
 *
 * Task 001-326: anchored at the process's start (`performance.timeOrigin`,
 * read in the `now` clock's frame), not at this check, which comes after the
 * entry's Node start, policy read and store open; under load those took
 * longer than the whole 2 s entry, and its handoff read as stale.
 */
async function handedOver(context: HookContext, deps: HookDeps, poll: number): Promise<boolean> {
  const since = (deps.now ?? Date.now)() - performance.now() - STOP_SLOW_HANDOFF_SLACK_MS;
  const deadline = performance.now() + STOP_SLOW_HANDOFF_MS;
  const { store, consumer } = context;
  for (;;) {
    const handed = readTransaction(store, () => {
      if (store.consumers.get(consumer) === null) return false;
      const turn = readTurn(store, consumer);
      return turn.turn === "idle" && turn.handoff !== undefined && turn.handoff.at >= since;
    });
    if (handed) return true;
    const left = deadline - performance.now();
    if (left <= 0) return false;
    await sleep(Math.min(poll, left));
  }
}

/** A block: its reason and the header and failures of the read it was decided from. */
interface Block {
  readonly header: StatusHeader;
  readonly failures: readonly KnownFailure[];
  readonly reason: string;
}

/**
 * Polls until no required check is open, `required.waitMs` passed, the
 * daemon is stopped by request (row 011-312), or the daemon has been down
 * for `STOP_SLOW_DOWN_MS`, then decides at the
 * live revision; polls again when that decision found them not complete
 * before the bound. Each group with a file not current is asked to run once,
 * with the time left (`requestGroups`). The block, or `null` for silence
 * and once the consumer is in a turn again or unregistered. Its elapsed time
 * is `deps.monotonicNow`'s.
 */
async function waitForRequired(
  context: HookContext,
  required: StopRequired,
  deps: HookDeps,
  poll: number,
): Promise<Block | null> {
  const clock = deps.now ?? Date.now;
  const elapsed = deps.monotonicNow ?? (() => performance.now());
  const bound = required.waitMs;
  const started = elapsed();
  const asked = new Set<string>();
  let downSince: number | null = null;
  for (;;) {
    if (!isRegistered(context)) return null;
    const last = read(context, required, clock);
    if (!last.idle) return null;
    const ask = openGroupsOf(last.open).filter((group) => !asked.has(group));
    if (ask.length > 0) {
      for (const group of ask) asked.add(group);
      const left = started + bound - elapsed();
      await requestGroups(context.store, context.consumer.worktreeId, ask, left);
      continue;
    }
    const now = elapsed();
    downSince = last.header.daemon?.state === "down" ? (downSince ?? now) : null;
    const down = downSince !== null && now - downSince >= STOP_SLOW_DOWN_MS;
    const left = started + bound - now;
    const over = left <= 0 || down || stoppedByRequest(last.header);
    if (!isOpen(last.open) || over) {
      const waitedMs = Math.min(bound, Math.round(now - started));
      const options = { over, waitedMs, command: deps.command };
      const decided = decide(context, required, clock(), options);
      if (decided !== "again") return decided;
    }
    await sleep(Math.min(poll, Math.max(0, left)));
  }
}

/**
 * The decision, from a read inside a write transaction, so no commit lands
 * between the read and the decision (review wave 13am, B2), by the one
 * owner of the required checks' holds (`requiredStep`, review 0.1.406-r2
 * B2-R1): `null` when the consumer is gone or in a turn, nothing required
 * is open or failing untold, or no hold is left this turn (019 D4 step 3);
 * `again` while a required check is open and the bound is not `over`; else
 * a block, which takes the turn and counts a hold in the same transaction.
 * `at` is read before the write lock.
 */
function decide(
  context: HookContext,
  required: StopRequired,
  at: EpochMs,
  {
    over,
    waitedMs,
    command,
  }: { readonly over: boolean; readonly waitedMs: number; readonly command: string | undefined },
): Block | "again" | null {
  const { store, consumer } = context;
  return store.transaction(() => {
    if (store.consumers.get(consumer) === null) return null;
    const live = read(context, required, () => at);
    if (!live.idle) return null;
    const untold = () => store.views.list(consumer);
    const step = requiredStep(context, required, live, { untold, at, command });
    if (step === null) return null;
    if (step.kind === "open" && !over) return "again";
    const holds = readStopHolds(store, consumer);
    if (holds >= required.maxHolds) return null;
    countStopHold(store, consumer);
    startTurn(store, consumer);
    const last = required.groupTexts && holds + 1 >= required.maxHolds;
    const reason = stepReason(step, required, live, { command, last, waitedMs });
    return { header: live.header, failures: live.failures, reason };
  });
}
