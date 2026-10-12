import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../../core/daemon/policy.js";
import { readLiveHeader } from "../../core/delivery/index.js";
import { readTurn, startTurn } from "../../core/delivery/turn.js";
import { testFileId } from "../../core/keys/index.js";
import { slowFiles } from "../../core/slow/index.js";
import { slowFilesNotCurrent, testFileOf, toKnownFailure } from "../../core/state/index.js";
import { readTransaction } from "../../core/store/index.js";
import type { KnownFailure, StatusHeader, TestFileRef } from "../../core/types/index.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { HOOK_TIMEOUT_MS, type HookDeps, isRegistered, withContext } from "./hook.js";
import { newsText, nudgeSlow } from "./stop.js";
import { slowFailuresReason, slowWaitReason, statusText } from "./text.js";

/**
 * The waiting Stop entry's `timeout` in both plugins' hooks.json, seconds:
 * above `STOP_SLOW_WAIT_CAP_MS` plus the handoff, so the bound, not the
 * harness, ends the wait.
 */
export const STOP_SLOW_HOOK_TIMEOUT_S = 630;

/** The longest `stop.slowWaitMs` honoured: 10 minutes, `slow.maxDeferMs`'s default. */
export const STOP_SLOW_WAIT_CAP_MS = 600_000;

/**
 * How long the waiting entry waits for the 2 s Stop entry beside it to end
 * the turn: that entry's whole hook timeout and a second more.
 */
export const STOP_SLOW_HANDOFF_MS = HOOK_TIMEOUT_MS + 1_000;

/**
 * How long before this Stop the 2 s entry may have heard from the consumer:
 * the harness starts both entries at once, and one that started first ran at
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
 * waits up to `STOP_SLOW_HANDOFF_MS` for that (`handedOver`). A 2 s entry that blocked or spoke leaves the turn going, and this
 * entry says nothing; one that ended the turn leaves the decision here, so
 * the two never both block. The 2 s entry never blocks on slow files for a
 * main agent.
 *
 * Then it nudges the daemon (`nudgeSlow`), so the idle slow tier starts now,
 * and polls until no slow file is pending at the current revision, the bound
 * passes, or the daemon has been down for `STOP_SLOW_DOWN_MS`. All current
 * with no failure among the files it waited for: `null`, the turn ends as
 * today. A failure among them: a block naming it, once. Files still not
 * current: a block naming them and `run --slow --wait`.
 *
 * A block first takes the turn in one transaction with the check that the
 * consumer is still idle: Claude Code's idle waiter may have woken the agent
 * meanwhile, or a prompt arrived, and then this entry says nothing. A Stop
 * with `stop_hook_active`, a SubagentStop, and a policy without
 * `requireSlowSuite` return `null` at once.
 */
export async function stopSlow(
  input: ConsumerInput & { readonly stopHookActive: boolean },
  location: HookLocation,
  deps: HookDeps,
): Promise<string | null> {
  if (input.stopHookActive || input.agent_id !== undefined) return null;
  const project = readPolicy(location.root);
  if (!project.stop.requireSlowSuite) return null;
  const bound = Math.max(0, Math.min(project.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
  const isSlow = slowFiles(project, project.nodeTest);
  const poll = deps.pollIntervalMs ?? STOP_SLOW_POLL_MS;
  return withContext(input, location, deps, async (context) => {
    if (!(await handedOver(context, deps, poll))) return null;
    const waited = read(context, isSlow, deps);
    if (waited.open.length === 0) return null;
    await nudgeSlow(context, waited.header);
    const end = await waitForSlow(context, isSlow, deps, bound, poll);
    if (end === null) return null;
    const files = new Set(waited.open.map(testFileId));
    const failed = end.current.filter((f) => files.has(testFileId(testFileOf(f.check))));
    const still = end.open.filter((f) => files.has(testFileId(f)));
    if (still.length === 0 && failed.length === 0) return null;
    if (!takeTurn(context)) return null;
    const reason =
      still.length > 0
        ? slowWaitReason(end.header.revision, still, bound, deps.command)
        : slowFailuresReason(end.header.revision, failed);
    const news = await newsText(context, {}, deps.command);
    return `${reason}\n\n${news ?? statusText(end.header, end.failures, deps.command)}`;
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

function read(
  context: HookContext,
  isSlow: (testFile: TestFileRef) => boolean,
  deps: HookDeps,
): SlowRead {
  const { store, consumer } = context;
  return readTransaction(store, () => {
    const states = store.knownStates.list(consumer.worktreeId);
    const keys = store.testFileKeys.list(consumer.worktreeId);
    const now = (deps.now ?? Date.now)();
    const header = readLiveHeader(store, consumer.worktreeId, now, states, null, keys);
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

/**
 * Whether the 2 s entry ended the turn: the consumer is idle and was heard
 * from since this Stop began, less `STOP_SLOW_HANDOFF_SLACK_MS`. The 2 s
 * entry's delivery records it as heard from and puts it in a turn in one
 * transaction, and only its silent end makes it idle again; so an idle
 * consumer heard from before this Stop is idle from before, and this entry
 * waits for the 2 s entry, which may not have started.
 */
async function handedOver(context: HookContext, deps: HookDeps, poll: number): Promise<boolean> {
  const since = (deps.now ?? Date.now)() - STOP_SLOW_HANDOFF_SLACK_MS;
  const deadline = performance.now() + STOP_SLOW_HANDOFF_MS;
  const { store, consumer } = context;
  for (;;) {
    const handed = readTransaction(store, () => {
      const record = store.consumers.get(consumer);
      if (record === null || record.lastSeenAt < since) return false;
      return readTurn(store, consumer).turn === "idle";
    });
    if (handed) return true;
    const left = deadline - performance.now();
    if (left <= 0) return false;
    await sleep(Math.min(poll, left));
  }
}

/**
 * Polls until no slow file is pending, `bound` passed, or the daemon has
 * been down for `STOP_SLOW_DOWN_MS`; the last read, or `null` once the
 * consumer is in a turn again or unregistered.
 */
async function waitForSlow(
  context: HookContext,
  isSlow: (testFile: TestFileRef) => boolean,
  deps: HookDeps,
  bound: number,
  poll: number,
): Promise<SlowRead | null> {
  const started = performance.now();
  let downSince: number | null = null;
  for (;;) {
    if (!isRegistered(context)) return null;
    const last = read(context, isSlow, deps);
    if (!last.idle) return null;
    const now = performance.now();
    downSince = last.header.daemon?.state === "down" ? (downSince ?? now) : null;
    const down = downSince !== null && now - downSince >= STOP_SLOW_DOWN_MS;
    const left = started + bound - now;
    if (last.open.length === 0 || left <= 0 || down) return last;
    await sleep(Math.min(poll, left));
  }
}

/** Puts the consumer in a turn if it is still idle; `false` when something else already did. */
function takeTurn(context: HookContext): boolean {
  const { store, consumer } = context;
  return store.transaction(() => {
    if (store.consumers.get(consumer) === null) return false;
    if (readTurn(store, consumer).turn !== "idle") return false;
    startTurn(store, consumer);
    return true;
  });
}
