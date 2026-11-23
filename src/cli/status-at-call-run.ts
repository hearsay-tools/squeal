import { repositoryRootOf } from "../core/daemon/user-config.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import type { RunRecord } from "../core/types/store-records.js";
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
import { type NamedRun, namedRun, runsInFlight } from "./status-at-estimate-named.js";
import {
  notStarted,
  type SideWaiting,
  sideWaits,
  withNotStarted,
} from "./status-at-estimate-waits.js";
import { idleOf } from "./status-at-idle.js";
import type { NowSide } from "./status-at-now.js";
import type { SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";
import {
  narrowQueue,
  type QueuedRun,
  type QueuedSide,
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
  const sides = [
    { queue: atCalled, state: atState, rest: after.rest.commit, id: rootId(atQueue) },
    { queue: nowCalled, state: nowState, rest: after.rest.now, id: input.place.worktreeId },
  ];
  // Row 023-71 (Y1): a narrowed call's files not started say why they wait, where it is published.
  const waits = narrowed ? waitsOf(input, sides) : [null, null];
  const commit = withWait(queuedSide(atCalled, atState, nowState), waits[0]);
  const now = withWait(queuedSide(nowCalled, nowState, atState), waits[1]);
  const estimate = estimateOf(input, {
    sides,
    measured: queue ? usedMs : null,
    // A narrowed call's files lead its daemons' queues: the rest is not ahead of them.
    ahead: !narrowed,
    waits,
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
    ...(queue ? {} : idleOf(after, atQueue, input.place.paths, runAgain(input.args.commit, paths))),
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

interface Side {
  readonly queue: SideQueue;
  readonly state: (ref: TestFileRef) => SideState;
  readonly rest: readonly TestFileRef[];
  readonly id: WorktreeId | null;
}

/** Row 023-71 (Y1): per side, why the call's files queued and not started wait, where published. */
function waitsOf(input: CallInput, sides: readonly Side[]): (SideWaiting | null)[] {
  return sideWaits(
    input.place.root,
    sides.map((side) => ({
      root: side.queue.root,
      id: side.id,
      queued: side.queue.files.filter((ref) => notStarted(side.state(ref))),
    })),
  );
}

const withWait = (side: QueuedSide, wait: SideWaiting | null | undefined): QueuedSide =>
  wait === null || wait === undefined ? side : { ...side, waiting: wait.reason };

interface EstimateSides {
  readonly sides: readonly Side[];
  /** The call's time so far when it queued (its rate counts), `null` for a join. */
  readonly measured: number | null;
  /** Whether the rest of a daemon's queue runs before the call's files. */
  readonly ahead: boolean;
  /** Row 023-71 (Y1): per side, why its files not started wait, where published. */
  readonly waits: readonly (SideWaiting | null)[];
}

/** V2: each side's estimate of what still runs; `null` when nothing does on either side. */
function estimateOf(
  input: CallInput,
  { sides, measured, ahead, waits }: EstimateSides,
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
  let runs: (readonly RunRecord[])[] | null = null;
  const inFlight = () => {
    runs ??= runsInFlight(root, ids);
    return runs;
  };
  try {
    const factor = loadNow();
    const seconds = (ref: TestFileRef) => durations?.of(ref) ?? null;
    // Review 0.1.599 B3: each side's files by group, at the limits its daemon runs them at.
    const done = sides.map((side) =>
      side.queue.files.filter((ref) => {
        const s = side.state(ref);
        return s.state === "pass" || s.state === "fail";
      }),
    );
    // Row 023-66 (V2): the results are counted per group, so a rate counts only where it was measured.
    const work = workGroups(
      sides.map((side, i) => ({
        root: side.queue.root,
        files: todo[i] ?? [],
        done: done[i] ?? [],
      })),
      seconds,
    );
    const [commit, now] = sides.map((side, i) => {
      const one: SideWork = {
        groups: work.groups[i] ?? [],
        measured: measured === null ? null : { done: done[i]?.length ?? 0, ms: measured },
        ...(work.unknown[i] === true ? { limitsUnknown: true } : {}),
      };
      const leftOut = left[i] ?? 0;
      const own = estimateSide(one, widths[i] ?? 1, factor);
      // Row 023-71 (Y1): a narrowed call's files none of which started have no time of their own.
      const estimate = ahead ? own : withNotStarted(own, todo[i] ?? [], side.state, waits[i]);
      // Row 023-60 (W3): a narrowed call's file that still runs in a wider batch waits for it.
      const runs = ahead || estimate === null ? [] : (inFlight()[i] ?? []);
      const at = { width: widths[i] ?? 1, factor, now: Date.now(), rate: null };
      const find = (rate: SideWork["measured"]) =>
        namedRun(runs, side.queue.files, todo[i] ?? [], seconds, { ...at, rate });
      const e = withBatch(estimate, groupBatch(find, work.doneIn[i], one.measured));
      // Row 023-62 (V2's rest): the files left out because their setup failed on the other side.
      if (leftOut === 0) return e;
      return e === null ? onlyLeftOut(leftOut) : { ...e, leftOut };
    });
    return { commit: commit ?? null, now: now ?? null };
  } finally {
    durations?.close();
  }
}

/**
 * Row 023-66 (V2): the batch that holds a named file (`find`), timed at the
 * rate of that file's group (`doneIn`, its results in this call), not the
 * side's (`measured`); `null` when none holds one.
 */
export function groupBatch(
  find: (rate: SideWork["measured"]) => NamedRun | null,
  doneIn: ((ref: TestFileRef) => number | null) | undefined,
  measured: SideWork["measured"],
): NamedRun | null {
  const [first] = find(null)?.named ?? [];
  if (first === undefined) return null;
  const own = doneIn?.(first) ?? null;
  return find(own === null || measured === null ? measured : { done: own, ms: measured.ms });
}

/** Row 023-60 (W3): the side's time is at least the batch's; review 0.1.607 B1: unknown with it. */
function withBatch(e: SideEstimate | null, batch: NamedRun | null): SideEstimate | null {
  if (e === null || batch === null) return e;
  const longer =
    e.seconds === null || batch.seconds === null ? null : Math.max(e.seconds, batch.seconds);
  return { ...e, seconds: longer, batch };
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
