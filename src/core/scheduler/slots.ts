import { isSlowLane, type TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { SHARE_FLOOR_MS } from "./sharing.js";
import { laneOf, type Tier, type TierFile } from "./tiers.js";

/**
 * The files one backlog slot holding `ref` runs (`RunnerAdapter.backlogSlot`,
 * spec 011 C4 step 5 as amended for slots, task 011-21 slice 2): 1 for
 * node:test, a batch for pytest; `null` when its runner runs its backlog in
 * tiers (Vitest).
 */
export function backlogSlot(context: SchedulerContext, ref: TestFileRef): number | null {
  const files = context.runner.backlogSlot?.(ref) ?? null;
  return files === null ? null : Math.max(1, Math.floor(files));
}

/**
 * The lanes no tier may start in now, of the tiers `inFlight` whose runs
 * have not ended (`selectTier`'s `busy`): one tier at a time per lane (task
 * 001-140), with two exceptions for a runner that cannot cancel a run
 * (spec 011 C4 step 5 as amended 2026-10-19, task 011-21):
 *
 * - An edit's tier starts beside the backlog's tiers or slots
 *   (`RunnerAdapter.besideBacklog`) while no edit's tier of the lane is in
 *   flight and an edit's work of it is queued, so the tier selected is an
 *   edit's, with no permit (C10).
 * - A lane that runs its backlog in slots (`backlogSlot`) takes its next
 *   backlog file while fewer than `runner.tierSize` slots run and no edit's
 *   work of it is queued, beside an edit's tier too; the pool's grant bounds
 *   the slots further, one permit each (slice 2).
 *
 * A slow lane runs one slow tier at a time (spec 004 D2).
 */
export function busyLanes(
  context: SchedulerContext,
  ledger: Ledger,
  inFlight: readonly Tier[],
): Set<string> {
  const held = new Map<string, Tier[]>();
  for (const tier of inFlight) held.set(tier.lane, [...(held.get(tier.lane) ?? []), tier]);
  const busy = new Set<string>();
  for (const [lane, tiers] of held) {
    const backlog = tiers.filter((tier) => tier.kind === "backlog");
    const edit = backlog.length < tiers.length;
    const queued = ledger.queue.hasFirstGroup((ref) => laneOf(context, ref) === lane);
    const lead = backlog[0]?.files[0]?.file.ref;
    const beside =
      queued && !edit && lead !== undefined && context.runner.besideBacklog?.(lead) === true;
    const any = tiers[0]?.files[0]?.file.ref;
    const slots =
      !queued &&
      !isSlowLane(lane) &&
      any !== undefined &&
      backlogSlot(context, any) !== null &&
      backlog.length < context.policy.runner.tierSize;
    if (!beside && !slots) busy.add(lane);
  }
  return busy;
}

/**
 * Whether `file` joins the backlog slot of `picked` (task 011-21 slice 2):
 * a slot of several files is one pytest batch, one process that runs them
 * in turn (spec 007 D6), so only light files share one, of last-known time
 * at most `SHARE_FLOOR_MS` (unknown counts 0, as in `joinSpan`), to amortise
 * its start; a heavier file runs alone. Every file of a slot is of one part
 * (`RunnerAdapter.tierPart`): a composite runs its owners in turn.
 */
export function joinsSlot(
  picked: readonly TierFile[],
  file: FileState,
  partOf: (ref: TestFileRef) => string,
): boolean {
  const light = (ms: number | null) => (ms ?? 0) <= SHARE_FLOOR_MS;
  const part = partOf(file.ref);
  return (
    light(file.durationMs) &&
    picked.every((p) => light(p.file.durationMs) && partOf(p.file.ref) === part)
  );
}
