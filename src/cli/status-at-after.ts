import { existsSync } from "node:fs";
import { resultsAt } from "../core/commit/at-keys-checkout.js";
import { worktreeIdFor, worktreeIdOfRealPath } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import type { SideQueue } from "./status-at-queue.js";
import { type SideState, stateOf } from "./status-at-report.js";

/*
 * Spec 023 D7.3 (row 023-40): each side as it stands when the wait ends.
 * The commit side is read again at D2's keys, the keys this call keyed in
 * its temporary checkout: what the commit daemon stored there since. A
 * file still without a result says why, from the daemon's own records:
 * still queued or running (its request not taken yet counts as queued),
 * its project's setup failed (R3, as the old in-call run said it), or the
 * daemon kept no result and why. The working tree's side is the daemon's
 * state as `nowSide` reads it, with the same reasons for its files.
 */

/** The daemon's worktree id, also once its tree is gone (a commit daemon's exit removes it). */
export function idOf(root: AbsolutePath): WorktreeId {
  return existsSync(root) ? worktreeIdFor(root) : worktreeIdOfRealPath(root);
}

/** Why a queued file has no result yet, from the daemon of `queue`. */
export function reasonOf(
  main: Store,
  queue: SideQueue,
): (ref: TestFileRef, key: string) => SideState | null {
  if (queue.root === null) return () => null;
  const id = idOf(queue.root);
  const rows = new Map(main.testFileKeys.list(id).map((row) => [testFileId(row.testFile), row]));
  const states = main.knownStates.list(id, queue.files);
  const setups = new Map<string, string>();
  for (const s of main.knownStates.list(id))
    if (s.check.kind === "setup" && s.outcome === "fail")
      setups.set(s.check.project, s.summary ?? "no text");
  const asked = new Set(queue.files.map(testFileId));
  return (ref, key) => {
    const fileId = testFileId(ref);
    if (!asked.has(fileId)) return null;
    if (queue.pending.has(fileId)) return { state: "no result", key, pending: "queued" };
    const row = rows.get(fileId);
    if (row?.pending !== null && row?.pending !== undefined)
      return { state: "no result", key, pending: row.pending };
    // D7.1 says the daemon's key is D2's by construction; when it is not, say so, never mix them.
    if (
      row?.key !== null &&
      row?.key !== undefined &&
      row.key !== key &&
      resultsAt(main, ref, row.key).length > 0
    )
      return {
        state: "not determined",
        reason: `the daemon stored it at key ${row.key.slice(0, 12)}, not at this call's ${key.slice(0, 12)}`,
      };
    const setup = setups.get(ref.project);
    if (setup !== undefined)
      return { state: "not run", reason: "setup", setup: `${queue.groupOf(ref)}: ${setup}` };
    const own = states.find(
      (s) => s.check.testPath === ref.path && s.check.project === ref.project && s.summary !== null,
    );
    if (own?.validity === "unknown" && own.summary !== null)
      return { state: "not determined", reason: `its run kept no result: ${own.summary}` };
    return null;
  };
}

/**
 * The commit side after the wait: `keyed` (the call's keying) read again
 * at its key; a result the commit daemon stored reads `commit` as origin.
 */
export function commitAfter(
  main: Store | null,
  keyed: (ref: TestFileRef) => SideState,
  queue: SideQueue,
  own: WorktreeId,
): (ref: TestFileRef) => SideState {
  if (main === null || queue.files.length === 0) return keyed;
  const reason = reasonOf(main, queue);
  const tree = queue.root === null ? null : idOf(queue.root);
  const states = new Map<string, SideState>();
  for (const ref of queue.files) {
    const before = keyed(ref);
    if (before.state !== "no result") continue;
    const now = stateOf(before.key, resultsAt(main, ref, before.key), own);
    if ("origin" in now && now.origin.worktreeId === tree)
      states.set(testFileId(ref), { ...now, origin: { ...now.origin, kind: "commit" } });
    else if (now.state !== "no result") states.set(testFileId(ref), now);
    else states.set(testFileId(ref), reason(ref, before.key) ?? before);
  }
  return (ref) => states.get(testFileId(ref)) ?? keyed(ref);
}

/** The working tree's side after the wait: `current`, with a reason for each queued file still without a result. */
export function nowAfter(
  main: Store | null,
  current: (ref: TestFileRef) => SideState,
  queue: SideQueue,
): (ref: TestFileRef) => SideState {
  if (main === null || queue.files.length === 0) return current;
  const reason = reasonOf(main, queue);
  const states = new Map<string, SideState>();
  for (const ref of queue.files) {
    const now = current(ref);
    if (now.state !== "no result" || now.pending !== undefined) continue;
    const why = reason(ref, now.key);
    if (why !== null) states.set(testFileId(ref), why);
  }
  return (ref) => states.get(testFileId(ref)) ?? current(ref);
}
