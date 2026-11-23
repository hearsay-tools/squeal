import { repositoryRootOf } from "../core/daemon/user-config.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import { storedDurations } from "./code-gate-durations.js";
import { idOf } from "./status-at-after.js";
import type { CallInput } from "./status-at-call.js";
import type { CommitSide } from "./status-at-commit.js";
import type { CommitAsked } from "./status-at-commit-ask.js";
import {
  type CallEstimate,
  estimateSide,
  loadNow,
  readPoolView,
  type SideEstimate,
  type SideWork,
  widthsOf,
} from "./status-at-estimate.js";
import { workGroups } from "./status-at-estimate-groups.js";
import type { NowSide } from "./status-at-now.js";
import type { SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";
import {
  narrowQueue,
  type QueuedRun,
  queuedSide,
  runAgain,
  waitAgain,
} from "./status-at-report-queued.js";

/*
 * Spec 023 D7.3 (rows 023-40, 023-40c): the report's part for a `--run`
 * or `--wait` call, from both daemons' queues and both sides after the
 * wait. Row 023-51 (V4): a narrowed call counts its own files, and the rest
 * of each daemon's queue apart. Row 023-52 (V6): a failed setup on one side
 * says what its files are on the other. Row 023-49 (V2): what still runs
 * gets an estimate per side.
 */

/** Both sides after the wait, with the rest of each daemon's queue (V4). */
export interface After {
  readonly at: CommitSide;
  readonly current: NowSide;
  readonly refs: readonly TestFileRef[];
  /** Per side, the daemon's files still queued or running outside the call's. */
  readonly rest: { readonly commit: readonly TestFileRef[]; readonly now: readonly TestFileRef[] };
  /** Row 023-59 (W2): `--wait` alone, per side, the call's files queued or running as it began. */
  readonly began?: {
    readonly commit: readonly TestFileRef[];
    readonly now: readonly TestFileRef[];
  };
}

/**
 * V4: the files the daemon of `id` has queued or running outside `call`;
 * none without a store or a daemon.
 */
export function restOf(
  main: Store | null,
  id: WorktreeId | null,
  call: readonly TestFileRef[],
): TestFileRef[] {
  if (main === null || id === null) return [];
  const ids = new Set(call.map(testFileId));
  return main.testFileKeys
    .list(id)
    .filter((row) => row.pending !== null && row.pending !== undefined)
    .map((row) => row.testFile)
    .filter((ref) => !ids.has(testFileId(ref)));
}

/** The report's part for the call (D7.3, Q7). */
export function queuedRun(
  input: CallInput,
  waitMs: number,
  [atQueue, nowQueue]: readonly [CommitAsked, SideQueue],
  after: After,
  queue: boolean,
): QueuedRun {
  const finite = Number.isFinite(waitMs);
  const { paths } = input.args;
  const narrowed = input.place.paths !== null;
  const call = narrowed ? after.refs : null;
  const atCalled = narrowQueue(atQueue, call);
  const nowCalled = narrowQueue(nowQueue, call);
  const atState = after.at.state;
  const nowState = after.current.state;
  const usedMs = Date.now() - input.startedMs;
  const commit = queuedSide(atCalled, atState, nowState);
  const now = queuedSide(nowCalled, nowState, atState);
  const estimate = estimateOf(input, {
    sides: [
      { queue: atCalled, state: atState, rest: after.rest.commit, id: rootId(atQueue) },
      { queue: nowCalled, state: nowState, rest: after.rest.now, id: input.place.worktreeId },
    ],
    measured: queue ? usedMs : null,
    // A narrowed call's files lead its daemons' queues: the rest is not ahead of them.
    ahead: !narrowed,
  });
  return {
    mode: queue ? "queue" : "join",
    waitMs: finite ? waitMs : null,
    usedMs,
    commit: {
      ...commit,
      rest: after.rest.commit.length,
      tree: atQueue.root,
      setup: setupOf(atQueue),
    },
    notSelected: notSelectedOf(after.at),
    now: {
      ...now,
      rest: after.rest.now.length,
      setup: after.current.source.kind === "setting up",
    },
    ...idleOf(after, queue, runAgain(input.args.commit, paths)),
    ...resolvedOf(after),
    again: finite ? waitAgain(input.args.commit, paths) : null,
    retry:
      atQueue.late === true || nowQueue.late === true ? runAgain(input.args.commit, paths) : null,
    ...(narrowed ? { paths } : {}),
    ...(estimate === null
      ? {}
      : {
          estimate,
          narrow: narrowed
            ? null
            : `squeal status --at ${shellWord(input.args.commit)} <path>... --run`,
        }),
  };
}

/**
 * Row 023-58 (W1): with `--wait` alone, the call's files known on one side
 * that the other side has no result for and does not run (the commit side
 * leaves out what the change did not select); nothing with `--run`.
 */
function idleOf(
  after: After,
  queue: boolean,
  command: string,
): { idle?: NonNullable<QueuedRun["idle"]> } {
  if (queue) return {};
  const known = (s: SideState) => s.state === "pass" || s.state === "fail";
  const idle = (s: SideState) =>
    s.state === "no result" && s.pending === undefined && s.notSelected !== true;
  const count = (here: (ref: TestFileRef) => SideState, there: (ref: TestFileRef) => SideState) =>
    after.refs.filter((ref) => known(there(ref)) && idle(here(ref))).length;
  const commit = count(after.at.state, after.current.state);
  const now = count(after.current.state, after.at.state);
  return commit + now === 0 ? {} : { idle: { commit, now, command } };
}

/** Row 023-59 (W2): `--wait` alone, the files that went from running to a result, per side. */
function resolvedOf(after: After): { resolved?: NonNullable<QueuedRun["resolved"]> } {
  if (after.began === undefined) return {};
  const known = (s: SideState) => s.state === "pass" || s.state === "fail";
  const done = (files: readonly TestFileRef[], state: (ref: TestFileRef) => SideState) => [
    ...new Set(files.filter((ref) => known(state(ref))).map((ref) => ref.path)),
  ];
  const commit = done(after.began.commit, after.at.state);
  const now = done(after.began.now, after.current.state);
  return commit.length + now.length === 0 ? {} : { resolved: { commit, now } };
}

const rootId = (queue: SideQueue): WorktreeId | null =>
  queue.root === null ? null : idOf(queue.root);

interface EstimateSides {
  readonly sides: readonly {
    readonly queue: SideQueue;
    readonly state: (ref: TestFileRef) => SideState;
    readonly rest: readonly TestFileRef[];
    readonly id: WorktreeId | null;
  }[];
  /** The call's time so far when it queued (its rate counts), `null` for a join. */
  readonly measured: number | null;
  /** Whether the rest of a daemon's queue runs before the call's files. */
  readonly ahead: boolean;
}

/** V2: each side's estimate of what still runs; `null` when nothing does on either side. */
function estimateOf(
  input: CallInput,
  { sides, measured, ahead }: EstimateSides,
): CallEstimate | null {
  const running = (s: SideState) => s.state === "no result" && s.pending !== undefined;
  const failedSetup = (s: SideState) => s.state === "not run" && s.reason === "setup";
  // Row 023-62 (V2's rest): a file whose batch's setup failed on the other side is left out.
  const other = (i: number) => sides[1 - i]?.state ?? (() => ({ state: "absent" }) as const);
  const still = sides.map((side) => side.queue.files.filter((ref) => running(side.state(ref))));
  const left = still.map((files, i) => files.filter((ref) => failedSetup(other(i)(ref))).length);
  const todo = sides.map((side, i) => [
    ...(still[i] ?? []).filter((ref) => !failedSetup(other(i)(ref))),
    ...(ahead ? side.rest : []),
  ]);
  if (todo.every((files) => files.length === 0) && left.every((n) => n === 0)) return null;
  const ids = sides.map((side) => side.id);
  const { root, commonDir } = input.place;
  // Review 0.1.599 B3: both daemons are the repository's, and share its `capacity.projects` cap.
  const pool = readPoolView(
    input.env,
    ids.filter((id) => id !== null),
    repositoryRootOf(root, commonDir),
  );
  const widths = widthsOf(
    pool,
    sides.map((side, i) => ({ id: side.id, want: todo[i]?.length ?? 0 })),
  );
  const durations = storedDurations(root);
  try {
    const factor = loadNow();
    const seconds = (ref: TestFileRef) => durations?.of(ref) ?? null;
    // Review 0.1.599 B3: each side's files by group, at the limits its daemon runs them at.
    const work = workGroups(
      sides.map((side, i) => ({ root: side.queue.root, files: todo[i] ?? [] })),
      seconds,
    );
    const [commit, now] = sides.map((side, i) => {
      const done = side.queue.files.filter((ref) => {
        const s = side.state(ref);
        return s.state === "pass" || s.state === "fail";
      }).length;
      const one: SideWork = {
        groups: work.groups[i] ?? [],
        measured: measured === null ? null : { done, ms: measured },
        ...(work.unknown[i] === true ? { limitsUnknown: true } : {}),
      };
      const leftOut = left[i] ?? 0;
      const e = estimateSide(one, widths[i] ?? 1, factor);
      if (leftOut === 0) return e;
      return e === null ? onlyLeftOut(leftOut) : { ...e, leftOut };
    });
    return { commit: commit ?? null, now: now ?? null };
  } finally {
    durations?.close();
  }
}

/** Row 023-62: a side whose every file still to run was left out of the estimate. */
function onlyLeftOut(leftOut: number): SideEstimate {
  return { files: 0, width: 1, seconds: null, basis: "unknown", known: 0, leftOut };
}

/** Row 023-40c: what the commit daemon still sets up when the wait ends; `null` when none. */
function setupOf(queue: CommitAsked): "install" | "starting" | "selecting" | null {
  const { setup } = queue;
  if (setup === null || setup.phase === "failed" || setup.phase === "changed") return null;
  if (setup.phase !== "ready") return setup.phase;
  return queue.asks.some((a) => a.phase === "waiting" || a.phase === "selecting")
    ? "selecting"
    : null;
}

/** R8: the files the commit side reads with no result that the change did not select. */
function notSelectedOf(at: CommitSide): number {
  return at.refs.filter((ref) => {
    const s = at.state(ref);
    return s.state === "no result" && s.notSelected === true;
  }).length;
}
