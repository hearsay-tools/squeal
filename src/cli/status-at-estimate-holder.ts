import { loadUserConfig } from "../core/daemon/user-config.js";
import { slotDirOf } from "../core/scheduler/group-limits.js";
import { heldPermits, type PermitRecord, slowSlotDir } from "../core/slow/slot.js";
import type { SlotFile } from "../core/slow/slot-holding.js";
import { pidRuns } from "../core/status/slot-holders.js";
import { durationText } from "../core/text.js";
import type { ResolvedGroup } from "../core/types/check-groups.js";
import type { WorktreeId } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";

/*
 * Row 023-77 (dogfood round 10, Z1; spec 023 D7.3): a side whose files
 * wait for a group's shared slot says who holds it, when the slot records
 * it. The slot's lock files record their holder (pid, worktree, since,
 * row 011-58) and the files it runs (`SlowSlot.holding`, row 023-77), so
 * the call reads only the group's `maxParallel` permit files, and only
 * while the side's daemon publishes that it waits for the slot. Review
 * 0.1.611 S1's rule holds: a holder is named only when every held permit
 * is one live process's, of another worktree, with its files recorded; a
 * dead holder, a record older than its permit (`holdingOf`), or a slot
 * held by several holders reads as before, without a holder.
 */

/** The slot's one holder, as recorded. */
export interface SlotHolder {
  readonly worktreeId: WorktreeId;
  readonly files: readonly SlotFile[];
  /** How long it has held the slot. */
  readonly heldMs: number;
}

/**
 * The holder of `group`'s shared slot for the repository whose Git common
 * dir is `commonDir`, waited on by worktree `own`; `null` when it is not
 * recorded, as above. Reads the slot's directory as the daemons name it
 * (`slowSlotDir`, `capacity.groupSlotScope` from the host config).
 */
export function slotHolder(
  group: ResolvedGroup,
  commonDir: string,
  own: WorktreeId,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): SlotHolder | null {
  const permits = group.limits.maxParallel;
  if (permits === null) return null;
  let held: ReturnType<typeof heldPermits>;
  try {
    const scope = loadUserConfig({ env }).config.capacity.groupSlotScope;
    const dir = slotDirOf(group.name, slowSlotDir(env), { scope, commonDir });
    held = heldPermits({ dir, permits, group: group.name });
  } catch {
    return null;
  }
  const records = held.map(({ record }) => record);
  const first = records[0];
  if (first === undefined || !records.every((r) => sameHolder(r, first))) return null;
  if (first.kind !== "holder" || first.files === undefined || first.files.length === 0) return null;
  if (first.worktreeId === own || !pidRuns(first.pid)) return null;
  return {
    worktreeId: first.worktreeId,
    files: first.files,
    heldMs: Math.max(0, now - first.since),
  };
}

function sameHolder(a: PermitRecord, b: PermitRecord): boolean {
  if (a.kind !== "holder" || b.kind !== "holder") return false;
  return a.pid === b.pid && a.worktreeId === b.worktreeId;
}

/**
 * `, which the working tree's run of x.e2e.ts holds (running for 40 s,
 * about 57 s left)`, after "the <g> group's slot". `who` names the
 * holder's worktree (`the working tree`); the time left is the longest
 * stored duration of its files less the time held, shown only when every
 * file has one and at least a second of it is left.
 */
export function holderText(holder: SlotHolder, who: string): string {
  const paths = holder.files.map((file) => file.path);
  const last = paths.at(-1) ?? "";
  const list = paths.length < 2 ? last : `${paths.slice(0, -1).join(", ")} and ${last}`;
  const durations = holder.files.map((file) => file.durationMs);
  const known = durations.every((ms): ms is number => ms !== null);
  const leftMs = known ? Math.max(...durations) - holder.heldMs : 0;
  const left = leftMs >= 1000 ? `, about ${durationText(leftMs)} left` : "";
  return `, which ${who}'s run of ${list} holds (running for ${durationText(holder.heldMs)}${left})`;
}

/** The main store's row of worktree `id`: its Git common dir, `null` when it has none. */
export function commonDirOf(store: Store, id: WorktreeId): string | null {
  return store.worktrees.get(id)?.commonDir ?? null;
}
