import { defaultGroups } from "../daemon/check-groups.js";
import { requestDaemon } from "../daemon/client.js";
import { requestGroupRun } from "../daemon/run-group.js";
import { readSlot, writeSlot } from "../delivery/slots.js";
import { isRecord } from "../fs/index.js";
import {
  type AbsolutePath,
  type Consumer,
  type Policy,
  SLOW_GROUP,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Spec 004 D9 as amended 2026-10-12 (task 001-285): which harness's waiting
 * Stop entry (`stop-slow`) ran for a session, and at which Squeal version. A
 * main agent's 2 s Stop leaves slow files to that entry only once it is known
 * to run there: Codex runs a new plugin hook only after the user trusts it,
 * and an untrusted or missing waiting entry must leave
 * `stop.requireSlowSuite` holding as it did before, never holding nothing.
 *
 * Task 001-297 (review wave 13am S1): the evidence is the consumer's, one
 * slot per consumer in one row per worktree (`slots.ts`),
 * `{ "<session>\n<agent>": { "<harness>": "<version>" } }`. Another session
 * in the worktree, with another config, launcher or trust, never inherits
 * it: its first Stop blocks on slow files as before, and its own waiting
 * entry, if it runs, marks it.
 *
 * Task 001-322 (review wave 13aw S1): the evidence is one registration's,
 * `{ "registeredAt": <ms>, "<harness>": "<version>" }`. A registration again,
 * after an unregister, an expiry or a `startup` or `resume` of the same
 * session id, starts unmarked, so a session resumed with its waiting entry
 * turned off blocks on slow files as before; its waiting entry, if it runs,
 * marks it at its next Stop. Compaction keeps the registration and so the
 * evidence. A waiting entry disabled within one registration is not seen.
 *
 * Task 001-328 (review wave 13ba B1): two registrations can share a
 * millisecond, so every registration forgets the slot in its own
 * transaction (`forgetStopWait`, called by the delivery's `register`).
 * `registeredAt` stays only so that slots no registration of this version
 * forgot read unmarked: one without it, written before 001-322, and one an
 * older hook's registration left.
 */

/**
 * The longest `stop.slowWaitMs` honoured: 59 minutes, below the waiting
 * entry's hook timeout of an hour (spec 019 D4 step 2). A whole slow tier of
 * 45 or more browser files took 17.5 min at the median and 32 min at p90
 * (`019-run-triggers/research/stop-wait.md` 3); the old cap, 10 minutes,
 * ended 82% of those waits early.
 */
export const STOP_SLOW_WAIT_CAP_MS = 3_540_000;

/**
 * How long the waiting entry waits at most for the daemon's answer to one
 * request: the CLI's socket budget, since that entry is not a 2 s hook.
 * Review 0.1.395, S2: never more than what is left of its wait's bound.
 */
export const STOP_SLOW_REQUEST_MS = 2_000;

/**
 * Spec 019 D4 step 1 (`stop-wait.md` 4, option d): the waiting Stop entry's
 * explicit request to the worktree's daemon to run each of `groups` now, as
 * `squeal run --slow` asks for the default `slow` group (`run-slow`). The
 * daemon queues every keyed file of the group that is not current, a file
 * not run and not queued (a `lookup-only` miss) and an `unknown` one
 * included (`queueGroup`), and runs them past the load guard and the fast
 * backlog, within the group's `maxParallel` (cases C4, C5 and C6's backlog;
 * a slot another worktree holds still makes them wait). The 2 s entry's
 * nudge only pumps files already queued, under the group's moment.
 *
 * The requests go out at once and share one socket budget: at most
 * `STOP_SLOW_REQUEST_MS`, and never more than `budgetMs`, what is left of the
 * wait's bound (review 0.1.395, S2). With nothing left it sends nothing: the
 * bound's block names the command that runs them. A daemon that does not
 * answer, or one from before the request, costs that budget and nothing more.
 */
export async function requestGroups(
  store: Store,
  worktreeId: WorktreeId,
  groups: readonly string[],
  budgetMs: number,
): Promise<void> {
  const budget = Math.min(STOP_SLOW_REQUEST_MS, Math.floor(budgetMs));
  if (budget <= 0 || groups.length === 0) return;
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null) return;
  await Promise.all(groups.map((group) => requestGroup(record.socketPath, group, budget)));
}

async function requestGroup(socketPath: AbsolutePath, group: string, budget: number) {
  if (group === SLOW_GROUP) {
    await requestDaemon(socketPath, { type: "run-slow" }, budget).catch(() => {});
    return;
  }
  // Spec 019 D4 step 1 (rows 019-14, 019-15): a configured group is asked by name.
  await requestGroupRun(socketPath, group, budget).catch(() => null);
}

/** `stop.slowWaitMs` as honoured: at least 0, at most `STOP_SLOW_WAIT_CAP_MS`. */
export function stopWaitBoundMs(policy: Policy): number {
  return Math.max(0, Math.min(policy.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
}

/**
 * How long a Stop waits for the default `slow` group's files under `policy`
 * (the `Slow tier:` line, 004 D8); `null` when Stop does not wait for them.
 * It reads the resolved group's `stopRequires` (spec 019 D2, row 019-23),
 * today `stop.requireSlowSuite`; a configured group's line reads its own
 * (`readGroupTiers`), with the same bound.
 */
export function stopSlowWaitMs(policy: Policy): number | null {
  const [, slow] = defaultGroups(policy);
  return slow.stopRequires ? stopWaitBoundMs(policy) : null;
}

/**
 * The harnesses whose Stop asks after a waiting Stop entry: Claude Code and
 * Codex have one; Pi has none, so its entry never runs (spec 009 D3).
 */
export type StopWaitHarness = "claude-code" | "codex" | "pi";

/** `meta` key of a worktree's waiting-entry record. */
export function stopWaitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("stopWait", worktreeId);
}

/** Whether `harness`'s waiting entry ran for `consumer` at `version`. */
export function stopWaitRuns(
  store: Store,
  consumer: Consumer,
  harness: StopWaitHarness,
  version: string,
): boolean {
  const registeredAt = store.consumers.get(consumer)?.registeredAt;
  if (registeredAt === undefined) return false;
  const value = readSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer);
  return isRecord(value) && value.registeredAt === registeredAt && value[harness] === version;
}

/**
 * Records that `harness`'s waiting entry runs for `consumer`'s current
 * registration at `version`; writes only a change, and nothing for a
 * consumer not registered.
 */
export function recordStopWait(
  store: Store,
  consumer: Consumer,
  harness: StopWaitHarness,
  version: string,
): void {
  store.transaction(() => {
    const registeredAt = store.consumers.get(consumer)?.registeredAt;
    if (registeredAt === undefined || stopWaitRuns(store, consumer, harness, version)) return;
    const key = stopWaitMetaKey(consumer.worktreeId);
    writeSlot(store, key, consumer, { registeredAt, [harness]: version });
  });
}

/** Forgets `consumer`'s waiting-entry record: every registration starts unmarked. Call inside a transaction. */
export function forgetStopWait(store: Store, consumer: Consumer): void {
  writeSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer, null);
}
