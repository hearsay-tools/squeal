import { heldUntilAsked } from "../core/daemon/check-groups.js";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import { testFileOf } from "../core/state/derive.js";
import { fileClassOf } from "../core/state/file-class.js";
import { onRequestFiles } from "../core/state/groups.js";
import type { WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { KnownState } from "../core/types/state.js";
import type { StatusSnapshot } from "../core/types/status.js";
import type { Store } from "../core/types/store.js";

/*
 * Row 011-426 (gh-293; 011 C6, C15): `status --wait` says when nothing left
 * in the worktree runs by itself, so waiting again changes nothing. In
 * 0.1.645 an agent read `98 queued, 47 unknown` after each wait, and waited
 * five more times for files of a `manual` group that run only on request
 * and files nothing queued.
 */

/** The sentence that ends a verdict line when `nothingRunsByItself`. */
export const NOTHING_RUNS_TEXT = "Nothing left runs by itself; waiting again changes nothing.";

/**
 * Whether every test file not current is on request (`onRequest`) or
 * unknown, with nothing running, queued or stale, and at least one such
 * file: with a live daemon that listed the revision, no install awaited, no
 * hold and no checkpoint running, so no read could later find more work.
 */
export function nothingRunsByItself(snapshot: StatusSnapshot): boolean {
  const files = snapshot.testFileCounts;
  const phases = snapshot.testFilesByPhase;
  if (files === undefined || phases === undefined) return false;
  if (snapshot.daemon?.state !== "alive" || snapshot.daemon.stopping !== undefined) return false;
  if (snapshot.testFilesListed === false || snapshot.runnerPartPending === true) return false;
  if (snapshot.awaitingInstall === true || (snapshot.holds ?? []).length > 0) return false;
  if (snapshot.checkpoint !== undefined && !snapshot.checkpoint.owed) return false;
  const tests = snapshot.testsByPhase ?? { running: 0, queued: 0 };
  if (phases.running + phases.queued + tests.running + tests.queued + files.stale > 0) return false;
  return (phases.onRequest ?? 0) + files.unknown > 0;
}

/**
 * The sentences that end the verdict line when `nothingRunsByItself`;
 * `null` otherwise.
 * With `groups`, the on-request groups whose files the edits select, it
 * names each group's run, which runs them now and waits (the wait compares
 * against no ref, so the run takes no `--base`).
 */
export function nothingRunsLine(
  snapshot: StatusSnapshot,
  groups: readonly string[],
  command: string,
): string | null {
  if (!nothingRunsByItself(snapshot)) return null;
  if (groups.length === 0) return NOTHING_RUNS_TEXT;
  const runs = groups.map((name) => `\`${command} run ${name} --wait\``);
  const names = listText(groups);
  const run = runs.length === 1 ? "runs" : "run";
  const wait = runs.length === 1 ? "waits" : "wait";
  return (
    `${NOTHING_RUNS_TEXT} The edits affect ${names} test files that do not run by themselves: ` +
    `${listText(runs)} ${run} them and ${wait} for their results.`
  );
}

/** `a`, `a and b`, `a, b and c`. */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Of `files` (the edits' test files), with `states` holding theirs, the groups at `commit` or `manual`
 * (`heldUntilAsked`) that own one not current that no request runs: on
 * request (`onRequestFiles`), or not queued at all. In `checks` order;
 * none without a `checks` key.
 */
export function onRequestGroupsOf(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[],
  states: readonly KnownState[],
): readonly string[] {
  const root = store.worktrees.get(worktreeId)?.root;
  if (root === undefined || files.length === 0) return [];
  const policy = readPolicy(root);
  if (policy.checks.length === 0) return [];
  const view = groupView(policy);
  const held = (ref: TestFileRef) => {
    const group = view.of(ref);
    return group.index !== null && heldUntilAsked(group.at);
  };
  const own = files.filter(held);
  if (own.length === 0) return [];
  // Every row: a lane's running files tell whether it runs a request (`onRequestFiles`).
  const keys = store.testFileKeys.list(worktreeId);
  const onRequest = onRequestFiles(store, worktreeId, keys, policy);
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const byFile = new Map<string, KnownState[]>();
  for (const state of states) {
    const id = testFileId(testFileOf(state.check));
    byFile.set(id, [...(byFile.get(id) ?? []), state]);
  }
  const names = new Set<string>();
  for (const ref of own) {
    const id = testFileId(ref);
    const row = rows.get(id);
    const unqueued =
      row !== undefined &&
      row.pending === null &&
      fileClassOf(row, byFile.get(id) ?? []) !== "current";
    if (onRequest.has(id) || unqueued) names.add(view.of(ref).name);
  }
  return view.groups.map((group) => group.name).filter((name) => names.has(name));
}
