import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../../core/daemon/policy.js";
import { squealVersion } from "../../core/daemon/version.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { type CurrentKeys, currentKeys, readTurn, startTurn } from "../../core/delivery/turn.js";
import { testFileId } from "../../core/keys/index.js";
import {
  recordStopWait,
  type StopWaitHarness,
  slowFiles,
  stopSlowWaitMs,
} from "../../core/slow/index.js";
import { slowFilesNotCurrent, testFileOf, toKnownFailure } from "../../core/state/index.js";
import { readTransaction } from "../../core/store/index.js";
import type {
  EpochMs,
  KnownFailure,
  StatusHeader,
  StopHandoff,
  TestFileRef,
} from "../../core/types/index.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
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
 * How long before this Stop the 2 s entry may have ended the turn: the
 * harness starts both entries at once, and one that started first ran at
 * most its hook timeout.
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
 * block. It first records that it runs here (`recordStopWait`); from then
 * on the 2 s entry leaves a main agent's slow files to it, and before that
 * blocks on them at once as it always did, which leaves this entry silent.
 * The 2 s entry's silent end already nudged the daemon (`nudgeSlow`), so the
 * idle slow tier has started.
 *
 * Task 001-295 (review wave 13am, B1): the files that silent end left owed,
 * at their keys (`StopHandoff`), are waited for from the start, so a result
 * that landed before this entry's first read is still decided; so is every
 * slow file a read here finds not current, at any key.
 *
 * Then it polls until the slow tier looks complete (no slow file pending
 * and the runner part of the revision applied), the bound passes, or the
 * daemon has been down for `STOP_SLOW_DOWN_MS`, and decides from a read in
 * a write transaction (`decide`, B2): what a poll saw may be a snapshot the
 * daemon has moved past, and the decision holds only for the live revision.
 * Complete with no failure among the files it waited for: `null`, the turn
 * ends as today. Not complete before the bound: it polls again, within the
 * same bound. A failure among them: a block naming it, once. Not complete
 * at the bound: a block naming the files and a pending runner part.
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
  const isSlow = slowFiles(project, project.nodeTest);
  const poll = deps.pollIntervalMs ?? STOP_SLOW_POLL_MS;
  return withContext(input, location, deps, async (context) => {
    const version = deps.squealVersion ?? squealVersion();
    recordStopWait(context.store, context.consumer.worktreeId, input.harness, version);
    const handoff = await handedOver(context, deps, poll);
    if (handoff === null) return null;
    const waited: Waited = { owed: handoff.keys, seen: new Set(), isSlow };
    const block = await waitForSlow(context, waited, deps, bound, poll);
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
  readonly keys: CurrentKeys;
  readonly idle: boolean;
}

/**
 * The files this entry waits for: those the 2 s entry left `owed`, by
 * `testFileId`, while at the key recorded there, and each slow file a read
 * here `seen` not current, at any key.
 */
interface Waited {
  readonly owed: StopHandoff["keys"];
  readonly seen: Set<string>;
  readonly isSlow: (testFile: TestFileRef) => boolean;
}

/** One read transaction; `clock` is read after the states and keys, inside it. */
function read(context: HookContext, waited: Waited, clock: () => EpochMs): SlowRead {
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const header = readLiveHeader(store, consumer.worktreeId, clock(), states, null, keys);
    const failures = states.flatMap((s) => toKnownFailure(s, header.revision) ?? []);
    const open = slowFilesNotCurrent(states, keys, waited.isSlow);
    for (const file of open) waited.seen.add(testFileId(file));
    return {
      header,
      failures,
      current: failures.filter((f) => f.validity === "current"),
      open,
      keys: currentKeys(keys),
      idle: readTurn(store, consumer).turn === "idle",
    };
  });
}

/** No slow file pending, and the runner part that may list more applied. */
function complete(last: SlowRead): boolean {
  return last.open.length === 0 && last.header.runnerPartPending !== true;
}

/** The current failures of slow files this entry waited for. */
function failedOf(last: SlowRead, waited: Waited): readonly KnownFailure[] {
  return last.current.filter((f) => {
    const file = testFileOf(f.check);
    if (!waited.isSlow(file)) return false;
    const id = testFileId(file);
    if (waited.seen.has(id)) return true;
    const recorded = waited.owed[id];
    return recorded !== undefined && (last.keys.get(id) ?? null) === recorded;
  });
}

/**
 * The handoff of the 2 s entry that ended the turn: the consumer is idle
 * with a `StopHandoff` written since this Stop began, less
 * `STOP_SLOW_HANDOFF_SLACK_MS`. Only that entry's silent end writes one, in
 * the transaction that makes the consumer idle, so an idle consumer without
 * a fresh one is idle from before, and this entry waits for the 2 s entry,
 * which may not have started. `null` when none came within
 * `STOP_SLOW_HANDOFF_MS`.
 */
async function handedOver(
  context: HookContext,
  deps: HookDeps,
  poll: number,
): Promise<StopHandoff | null> {
  const since = (deps.now ?? Date.now)() - STOP_SLOW_HANDOFF_SLACK_MS;
  const deadline = performance.now() + STOP_SLOW_HANDOFF_MS;
  const { store, consumer } = context;
  for (;;) {
    const handoff = readTransaction(store, () => {
      if (store.consumers.get(consumer) === null) return null;
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle" || turn.handoff === undefined) return null;
      return turn.handoff.at >= since ? turn.handoff : null;
    });
    if (handoff !== null) return handoff;
    const left = deadline - performance.now();
    if (left <= 0) return null;
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
  waited: Waited,
  deps: HookDeps,
  bound: number,
  poll: number,
): Promise<Block | null> {
  const clock = deps.now ?? Date.now;
  const started = performance.now();
  let downSince: number | null = null;
  for (;;) {
    if (!isRegistered(context)) return null;
    const last = read(context, waited, clock);
    if (!last.idle) return null;
    const now = performance.now();
    downSince = last.header.daemon?.state === "down" ? (downSince ?? now) : null;
    const down = downSince !== null && now - downSince >= STOP_SLOW_DOWN_MS;
    const left = started + bound - now;
    const over = left <= 0 || down;
    if (complete(last) || over) {
      const waitedMs = Math.min(bound, Math.round(now - started));
      const decided = decide(context, waited, clock(), { over, waitedMs, command: deps.command });
      if (decided !== "again") return decided;
    }
    await sleep(Math.min(poll, Math.max(0, left)));
  }
}

/**
 * The decision, from a read inside a write transaction, so no commit lands
 * between the read and the decision (review wave 13am, B2): `null` when the
 * consumer is gone or in a turn, or the slow tier is complete with no
 * failure it waited for; `again` when it is not complete and the bound is
 * not `over`; else a block, which takes the turn in the same transaction.
 * `at` is read before the write lock.
 */
function decide(
  context: HookContext,
  waited: Waited,
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
    const live = read(context, waited, () => at);
    if (!live.idle) return null;
    const failed = failedOf(live, waited);
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
