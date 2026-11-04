import { testFileId } from "../keys/index.js";
import { groupView } from "../scheduler/slow.js";
import { stopWaitBoundMs } from "../slow/stop-wait.js";
import type { KnownState, Policy, TestFileKeyRecord, TestFileRef } from "../types/index.js";
import { classifyGroupFiles, groupTextsShown } from "./groups.js";
import { classifySlowFiles } from "./slow.js";

/*
 * Spec 019 D4: the checks Stop requires, read by both Stop entries from the
 * store and the worktree's policy, with no daemon. A group requires Stop to
 * wait for it when its resolved `stopRequires` is set (019-07): every group
 * at `stop`, and the default `slow` group under `stop.requireSlowSuite`
 * whatever `slow.trigger` says. Test files only: lint keeps its own Stop
 * rules (017 D8).
 */

/** What Stop requires under one policy. */
export interface StopRequired {
  /** The name of the group Stop waits for that owns `ref`; `null` when Stop does not require it. */
  readonly groupOf: (ref: TestFileRef) => string | null;
  /** The names of the groups Stop waits for, in the order that decides ownership (row 019-23). */
  readonly groups: readonly string[];
  /** How long the waiting entry waits for them (`stop.slowWaitMs`, at most `STOP_SLOW_WAIT_CAP_MS`). */
  readonly waitMs: number;
  /** `stop.maxHolds`: how many times Stop may hold the agent for them in one turn. */
  readonly maxHolds: number;
  /**
   * Row 019-30: the policy has a `checks` key (`groupTextsShown`), so a hold
   * names why a group has not started and says when it is the last one.
   * Without it every text is as before.
   */
  readonly groupTexts: boolean;
  /** The groups `group` follows at its moment (`after`, D1); none for a name no group has. */
  readonly after: (group: string) => readonly string[];
  /** The name of the group that owns `ref`, whether Stop waits for it or not. */
  readonly ownerOf: (ref: TestFileRef) => string;
}

/** What Stop requires under `policy`; `null` when no group has Stop wait for it. */
export function stopRequired(policy: Policy): StopRequired | null {
  const view = groupView(policy);
  const groups = view.groups.filter((group) => group.stopRequires).map((group) => group.name);
  if (groups.length === 0) return null;
  return {
    groups,
    groupOf: (ref) => {
      const group = view.of(ref);
      return group.stopRequires ? group.name : null;
    },
    waitMs: stopWaitBoundMs(policy),
    maxHolds: Math.max(1, policy.stop.maxHolds),
    groupTexts: groupTextsShown(policy),
    after: (group) => view.groups.find((g) => g.name === group)?.after ?? [],
    ownerOf: (ref) => view.of(ref).name,
  };
}

/** One listed test file Stop requires that is not current, and the group that owns it. */
export interface RequiredFile {
  readonly group: string;
  readonly ref: TestFileRef;
}

/**
 * The listed test files Stop requires that are not current: pending or not
 * run (spec 004 D7 for the default `slow` group, 019 D4 for every group), in
 * the store's order. Moved from `slowFilesNotCurrent` (row 019-14).
 */
export function requiredNotCurrent(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  required: StopRequired,
): readonly RequiredFile[] {
  const files = classifySlowFiles(states, keys, (ref) => required.groupOf(ref) !== null);
  return [...files.values()].flatMap((file) => {
    const group = required.groupOf(file.ref);
    return file.class === "current" || group === null ? [] : [{ group, ref: file.ref }];
  });
}

/** Each group of `open`, once, in the order of its first file. */
export function openGroups(open: readonly RequiredFile[]): readonly string[] {
  return [...new Set(open.map((file) => file.group))];
}

/** A group a required group follows, with its test files pending (row 019-30). */
export interface PendingBefore {
  readonly group: string;
  /** Its test files pending: queued or running, as its status line counts them. */
  readonly pending: number;
}

/**
 * Row 019-30 (lessons P5, option a): why `group`'s files in `open` have not
 * started at Stop's bound. None of them is running, and the groups it
 * follows (`after`, D1) that have test files pending, in `after` order, each
 * with its count, as its status line classes them (`classifyGroupFiles`).
 * Empty when `group` has no file in `open`, one of them is running, or no
 * group it follows has a test file pending.
 */
export function pendingBefore(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  required: StopRequired,
  group: string,
  open: readonly RequiredFile[],
): readonly PendingBefore[] {
  const mine = new Set(open.filter((f) => f.group === group).map((f) => testFileId(f.ref)));
  if (mine.size === 0) return [];
  if (keys.some((k) => k.pending === "running" && mine.has(testFileId(k.testFile)))) return [];
  return required.after(group).flatMap((name) => {
    const files = classifyGroupFiles(states, keys, (ref) => required.ownerOf(ref) === name);
    const pending = [...files.values()].filter((file) => file.class === "pending").length;
    return pending > 0 ? [{ group: name, pending }] : [];
  });
}
