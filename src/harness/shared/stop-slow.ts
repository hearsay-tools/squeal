import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../../core/daemon/policy.js";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { readTurn, startTurn } from "../../core/delivery/turn.js";
import {
  recordStopWait,
  type StopWaitHarness,
  slowFiles,
  stopSlowWaitMs,
} from "../../core/slow/index.js";
import {
  checkIdentity,
  sameFingerprint,
  slowFilesNotCurrent,
  testFileOf,
  toKnownFailure,
} from "../../core/state/index.js";
import { readTransaction } from "../../core/store/index.js";
import type {
  EpochMs,
  KnownFailure,
  StatusHeader,
  TestFileRef,
  ViewEntry,
} from "../../core/types/index.js";
import { slowProjects } from "../../runners/descriptions.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
import { unchangedSinceRegistration } from "./no-edit.js";
import { newsText } from "./stop.js";
import { slowFailuresReason, slowWaitReason, statusText } from "./text.js";

/**
 * The waiting Stop entry's `timeout` in both plugins' hooks.json, seconds:
 * above `STOP_SLOW_WAIT_CAP_MS` plus the handoff, so the bound, not the
 * harness, ends the wait.
 */
export const STOP_SLOW_HOOK_TIMEOUT_S = 630;

export { STOP_SLOW_WAIT_CAP_MS } from "../../core/slow/index.js";

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
 * The waiting Stop entry (spec 004 D9 as amended 2026-10-12): with
 * `stop.requireSlowSuite` on, a main agent's Stop waits up to
 * `stop.slowWaitMs` for its slow files to become current, and returns a block
 * reason or `null`.
 *
 * Claude Code and Codex run a Stop event's entries in parallel, so this one
 * decides only after the 2 s entry (`stopTurn`) ended the turn silently: it
 * waits up to `STOP_SLOW_HANDOFF_MS` for that (`handedOver`). A 2 s entry
 * that blocked or spoke leaves the turn going, and this entry says nothing;
 * one that ended the turn leaves the decision here, so the two never both
 * block. It first records that it runs for this session (`recordStopWait`);
 * from then on the session's 2 s entry leaves its slow files to it, and
 * before that blocks on them at once as it always did, which leaves this
 * entry silent.
 * The 2 s entry's silent end already nudged the daemon (`nudgeSlow`), so the
 * idle slow tier has started.
 *
 * A worktree with no revision since the consumer registered
 * (`unchangedSinceRegistration`, task 004-67, issue 19) is a session that
 * changed nothing: it is not held for its slow files, and this entry returns
 * `null` once the handoff came, without waiting.
 *
 * Then it polls until the slow tier looks complete (no slow file pending
 * and the runner part of the revision applied), the bound passes, or the
 * daemon has been down for `STOP_SLOW_DOWN_MS`, and decides from a read in
 * a write transaction (`decide`, review wave 13am B2): what a poll saw may
 * be a snapshot the daemon has moved past, and the decision holds only for
 * the live revision. Not complete before the bound: it polls again, within
 * the same bound. Not complete at the bound: a block naming the files and
 * a pending runner part. Complete: a block naming each slow check that is
 * a current failure this session was not told (`untold`), at whatever
 * revision or key it ran; with none, `null`, and the turn ends as today.
 * Task 001-305 (the human, after review waves 13am, 13an and 13ap): it
 * keeps no list of the files it owes, which each review found a narrower
 * race past; a failure told before the turn ended, or the same failure at
 * a newer key, never blocks.
 *
 * A block takes the turn in that transaction, with the check that the
 * consumer is still idle: Claude Code's idle waiter may have woken the agent
 * meanwhile, or a prompt arrived, and then this entry says nothing. Its news
 * is delivered only at the decided revision, else its text is the decided
 * read's header, so a reason never sits beside a newer header. A Stop with
 * `stop_hook_active`, a SubagentStop, and a policy without `requireSlowSuite`
 * return `null` at once.
 */
export async function stopSlow(
  input: ConsumerInput & { readonly stopHookActive: boolean; readonly harness: StopWaitHarness },
  location: HookLocation,
  deps: HookDeps,
): Promise<string | null> {
  if (input.stopHookActive || input.agent_id !== undefined) return null;
  const project = readPolicy(location.root);
  const bound = stopSlowWaitMs(project);
  if (bound === null) return null;
  const isSlow = slowFiles(project, slowProjects(project));
  const poll = deps.pollIntervalMs ?? STOP_SLOW_POLL_MS;
  return withContext(input, location, deps, async (context) => {
    const version = deps.squealVersion ?? squealVersion();
    recordStopWait(context.store, context.consumer, input.harness, version);
    if (!(await handedOver(context, deps, poll))) return null;
    const { store, consumer } = context;
    if (readTransaction(store, () => unchangedSinceRegistration(store, consumer))) return null;
    const block = await waitForSlow(context, isSlow, deps, bound, poll);
    if (block === null) return null;
    const { header, failures, reason } = block;
    const news = await newsText(context, {}, deps.command, header.revision);
    return `${reason}\n\n${news ?? statusText(header, failures, deps.command)}`;
  });
}

/** What one read of the store says about the slow tier, the turn and the daemon. */
interface SlowRead {
  readonly header: StatusHeader;
  readonly failures: readonly KnownFailure[];
  readonly current: readonly KnownFailure[];
  readonly open: readonly TestFileRef[];
  readonly idle: boolean;
}

/** One read transaction; `clock` is read after the states and keys, inside it. */
function read(
  context: HookContext,
  isSlow: (testFile: TestFileRef) => boolean,
  clock: () => EpochMs,
): SlowRead {
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, clock(), states, null, keys);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
    return {
      header,
      failures,
      current: failures.filter((f) => f.validity === "current"),
      open: slowFilesNotCurrent(states, keys, isSlow),
      idle: readTurn(store, consumer).turn === "idle",
    };
  });
}

/** No slow file pending, and the runner part that may list more applied. */
function complete(last: SlowRead): boolean {
  return last.open.length === 0 && last.header.runnerPartPending !== true;
}

/**
 * The current failures of slow checks the consumer was not told: its view
 * (`ViewEntry`) holds no failure of the check with this fingerprint, so a
 * delivery now would name it. `views` is read only when a slow check fails.
 */
function untold(
  last: SlowRead,
  isSlow: (testFile: TestFileRef) => boolean,
  views: () => readonly ViewEntry[],
): readonly KnownFailure[] {
  const failed = last.current.filter((f) => isSlow(testFileOf(f.check)));
  if (failed.length === 0) return failed;
  const told = new Map(views().map((v) => [checkIdentity(v.check), v]));
  return failed.filter((f) => {
    const view = told.get(checkIdentity(f.check));
    return view?.outcome !== "fail" || !sameFingerprint(view.fingerprint, f.fingerprint);
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
 * Polls until the slow tier looks complete, `bound` passed, or the daemon
 * has been down for `STOP_SLOW_DOWN_MS`, then decides at the live revision;
 * polls again when that decision found it not complete before the bound.
 * The block, or `null` for silence and once the consumer is in a turn again
 * or unregistered.
 */
async function waitForSlow(
  context: HookContext,
  isSlow: (testFile: TestFileRef) => boolean,
  deps: HookDeps,
  bound: number,
  poll: number,
): Promise<Block | null> {
  const clock = deps.now ?? Date.now;
  const started = performance.now();
  let downSince: number | null = null;
  for (;;) {
    if (!isRegistered(context)) return null;
    const last = read(context, isSlow, clock);
    if (!last.idle) return null;
    const now = performance.now();
    downSince = last.header.daemon?.state === "down" ? (downSince ?? now) : null;
    const down = downSince !== null && now - downSince >= STOP_SLOW_DOWN_MS;
    const left = started + bound - now;
    const over = left <= 0 || down;
    if (complete(last) || over) {
      const waitedMs = Math.min(bound, Math.round(now - started));
      const decided = decide(context, isSlow, clock(), { over, waitedMs, command: deps.command });
      if (decided !== "again") return decided;
    }
    await sleep(Math.min(poll, Math.max(0, left)));
  }
}

/**
 * The decision, from a read inside a write transaction, so no commit lands
 * between the read and the decision (review wave 13am, B2): `null` when the
 * consumer is gone or in a turn, or the slow tier is complete with no slow
 * failure untold; `again` when it is not complete and the bound is
 * not `over`; else a block, which takes the turn in the same transaction.
 * `at` is read before the write lock.
 */
function decide(
  context: HookContext,
  isSlow: (testFile: TestFileRef) => boolean,
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
    const live = read(context, isSlow, () => at);
    if (!live.idle) return null;
    const failed = untold(live, isSlow, () => store.views.list(consumer));
    const done = complete(live);
    if (done && failed.length === 0) return null;
    if (!done && !over) return "again";
    startTurn(store, consumer);
    const { header, failures } = live;
    const reason = done
      ? slowFailuresReason(header.revision, failed)
      : slowWaitReason(header.revision, live.open, waitedMs, command, header.runnerPartPending);
    return { header, failures, reason };
  });
}
