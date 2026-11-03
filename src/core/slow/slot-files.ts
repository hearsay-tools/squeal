import { createHash } from "node:crypto";
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

export const SLOW_LOCK_FILE = "slow.lock";

/** The default `slow` group (spec 019 D2): its slot keeps the files it had before groups. */
const SLOW_GROUP = "slow";

/** A `checks[].name` (019-07's form): a word, so it is one file-name part. */
const GROUP_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The names of one group's slot files in the slot's directory. */
export interface SlotFiles {
  /** Permit `i`'s lock file. */
  permit(i: number): string;
  /** What every waiter's mark is named after, before its worktree's hash. */
  readonly waiterPrefix: string;
}

/**
 * The files of `group`'s `maxParallel` slot (spec 019 D3, row 019-11). The
 * default `slow` group keeps today's: `slow.lock`, then `slow.<i>.lock`,
 * and waiter marks `slow.wait.*`, so an older daemon and `Slow slot:` read
 * the same files. Any other group's are `group.<name>.<i>.lock` and
 * `group.<name>.wait.*`, so two groups' permits are independent. Every
 * group's slot is the user's, in one directory, as the slow slot is (004
 * D2); spec 019 open question 8 may scope a configured group to one
 * repository, which changes these names alone. Throws for a name that is
 * not a group's word, before any file is made.
 */
export function slotFiles(group: string = SLOW_GROUP): SlotFiles {
  if (group === SLOW_GROUP) {
    return {
      permit: (i) => (i === 0 ? SLOW_LOCK_FILE : `slow.${i}.lock`),
      waiterPrefix: "slow.wait.",
    };
  }
  if (!GROUP_NAME.test(group)) throw new Error(`not a check group name: ${JSON.stringify(group)}`);
  return { permit: (i) => `group.${group}.${i}.lock`, waiterPrefix: `group.${group}.wait.` };
}

/**
 * How long a waiter's mark counts: twice the slow tier's 15 s recheck, so a
 * daemon still retrying keeps it fresh and one that stopped wanting the slot
 * (it died, its fast work came first, its trigger went) is soon ignored. A
 * daemon whose load guard waits leaves no mark, since it waits only while
 * the slot is free (task 004-84).
 */
export const SLOT_WAITER_FRESH_MS = 30_000;

function waiterPath(dir: AbsolutePath, worktreeId: WorktreeId, group?: string): AbsolutePath {
  const name = createHash("sha256").update(worktreeId).digest("hex").slice(0, 16);
  return join(dir, `${slotFiles(group).waiterPrefix}${name}`);
}

/**
 * Spec 004 D2, lessons defect 2: a daemon that wants the slot and did not
 * take it leaves its worktree's mark in the slot's directory, refreshed on
 * each retry. A holder between files that finds another worktree's fresh
 * mark skips one turn (`othersWaitingForSlot`), so the slot is handed over
 * file by file: the holder takes it on its next pass only if the waiter did not.
 * The waiter takes it at the handover without a new load guard wait (task 004-84).
 * `group` names the slot (`slotFiles`); default the `slow` group's.
 */
export function markSlotWaiter(dir: AbsolutePath, worktreeId: WorktreeId, group?: string): void {
  writeFileSync(waiterPath(dir, worktreeId, group), `${worktreeId}\n`, { mode: 0o600 });
}

/** The worktree no longer waits for `group`'s slot: it took it, or wants it no more. */
export function clearSlotWaiter(dir: AbsolutePath, worktreeId: WorktreeId, group?: string): void {
  rmSync(waiterPath(dir, worktreeId, group), { force: true });
}

/** Another worktree's mark for `group`'s slot younger than `SLOT_WAITER_FRESH_MS` is in `dir`. */
export function othersWaitingForSlot(
  dir: AbsolutePath,
  worktreeId: WorktreeId,
  now: number = Date.now(),
  group?: string,
): boolean {
  const own = waiterPath(dir, worktreeId, group);
  const prefix = slotFiles(group).waiterPrefix;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  return names.some((name) => {
    const path = join(dir, name);
    if (!name.startsWith(prefix) || path === own) return false;
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat !== undefined && now - stat.mtimeMs < SLOT_WAITER_FRESH_MS;
  });
}
