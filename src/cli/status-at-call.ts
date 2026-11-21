import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { commitFolderName } from "../core/checkout/commit-identity.js";
import { environmentFingerprint } from "../core/checkout/commit-places.js";
import {
  cacheCheckoutsDir,
  cacheCheckoutsRoot,
  gitCheckoutsDir,
} from "../core/checkout/location.js";
import { treePath } from "../core/checkout/marker.js";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { selects } from "../core/commit/at-keys-narrow.js";
import { readPolicy } from "../core/daemon/policy.js";
import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import type { CliIo } from "./main.js";
import type { AtArgs, AtOptions } from "./status-at.js";
import { idOf, nowAfter } from "./status-at-after.js";
import { assembleReport } from "./status-at-assemble.js";
import type { CommitSide } from "./status-at-commit.js";
import { askCommit, type CommitAsked, joinCommit } from "./status-at-commit-ask.js";
import { rowsSide } from "./status-at-commit-rows.js";
import { type AtDaemons, type CommitDaemonInput, realDaemons } from "./status-at-daemons.js";
import { uncommitted } from "./status-at-dirty.js";
import { joinNow } from "./status-at-join.js";
import { listLate, type NowInput, type NowSide, nowSide } from "./status-at-now.js";
import { RECORD_WAIT_MS, type SideQueue, worktreeTwice } from "./status-at-queue.js";
import { unionRefs } from "./status-at-refs.js";
import { exitCode, formatAt, jsonAt } from "./status-at-report.js";
import {
  type QueuedRun,
  queuedSide,
  RUN_WAIT_MS,
  runAgain,
  waitAgain,
} from "./status-at-report-queued.js";
import { estimateOf, tellsEstimate } from "./status-at-run-batches.js";

/*
 * Spec 023 D7.3 (row 023-40; row 023-40c, D7.3 as amended 2026-11-21, the
 * human: "A: daemon owns setup"): `status --at <commit> --run [--wait
 * [<ms>]]` and `status --at <commit> --wait [<ms>]`. With `--run` the call
 * keys nothing and installs nothing at the commit: it sends the change
 * (`git diff <commit>..HEAD` and the working tree's changes) and its named
 * paths to the commit daemon (its worktree made with no install and its
 * daemon started when none serves it), which installs, keys, selects (D4.5)
 * and runs; the working tree's selected files go to this worktree's daemon
 * (started when none runs). Every step ends by one bound, the wait (100 s
 * by default; `--wait <ms>` sets it, a bare `--wait` waits until done) less
 * a reserve for the report; then the call reads both sides, the commit
 * side at its daemon's live keys, and reports what is known and what is
 * still setting up or running. What still runs goes on in the daemons and
 * Q7's line says so. `--wait` without `--run` joins what the daemons keep
 * and starts none.
 */

/** Row 023-40c: kept back from the wait for reading both sides and the report. */
export const REPORT_RESERVE_MS = 2_000;

/** Where the call runs, as `statusAtCommand` located it. */
export interface CallPlace {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly commit: string;
  readonly paths: readonly RelativePath[] | null;
}

export interface CallInput {
  readonly args: AtArgs;
  readonly place: CallPlace;
  /** What reads the working tree's side again. */
  readonly read: Omit<NowInput, "main">;
  /** The working tree's side as read at the call's start. */
  readonly now: NowSide;
  readonly env: NodeJS.ProcessEnv;
  /** Epoch ms when the call started: the wait's bound counts from it. */
  readonly startedMs: number;
  readonly io: CliIo;
  readonly options: AtOptions;
}

/** D7.3: queue (or join), wait, read both sides again, report; D1's exit code. */
export async function daemonCall(input: CallInput): Promise<number> {
  const { args, place, io, options } = input;
  const { root, commonDir, commit } = place;
  const run = args.run ?? null;
  const waitMs = args.waitMs ?? (run === null ? 0 : RUN_WAIT_MS);
  const note = (text: string) =>
    io.stderr(text.startsWith("squeal: ") ? `${text}\n` : `squeal: ${text}\n`);
  // Review wave-23 B1, row 023-40c: one bound for every step, counted from the call's start. The
  // waits end by `bound`; the worktree, the starts and the asks by `askBy`, at least
  // `RECORD_WAIT_MS` after the start, so even `--wait 0` queues its files.
  const bound = Math.max(input.startedMs, input.startedMs + waitMs - REPORT_RESERVE_MS);
  const askBy = Math.max(bound, input.startedMs + RECORD_WAIT_MS);
  const commitInput: CommitDaemonInput = {
    root,
    commit,
    environment: environmentOf(await commitAllowlist(root, commit), input.env),
    note,
    ...defined({
      limit: readPolicy(root).daemon.maxCommitDaemons ?? undefined,
      cacheRoot: options.cacheRoot,
      placeWaitMs: options.placeWaitMs,
    }),
  };
  const daemons = options.daemons ?? realDaemons({ note });
  const listed = await listLate(input.read, input.now, input.now.refs);
  const [atQueue, nowQueue] =
    run === null
      ? await Promise.all([
          joinedCommit(daemons, commitInput, commonDir, place.paths, bound),
          joinNow({ daemons, root, refs: listed.refs, now: listed.state, deadline: bound }),
        ])
      : await queueBoth(input, { daemons, commit: commitInput, now: listed, bound, askBy, run });
  if (run !== null) tellEstimate(atQueue.files, args, waitMs, root, commit, note);
  const after = await readAfter(input, atQueue, nowQueue, run !== null);
  const report = await assembleReport({
    root,
    commit,
    refs: after.refs,
    unmatched: after.unmatched,
    current: after.current,
    // Review wave-23 S2: Q1's step was read before the wait; the call's own lines say what is next.
    side: { at: after.at, ran: null, probe: null, state: after.at.state },
    part: null,
    queued: queuedRun(input, waitMs, [atQueue, nowQueue], after, run !== null),
  });
  io.stdout(args.json ? jsonAt(report) : formatAt(report, input.startedMs, args.full === true));
  return after.unmatched.length === 0 ? exitCode(report.files) : 3;
}

/**
 * `--run`: the commit side's ask and the working tree's side together. The
 * working tree runs at once the files the change and the call name with no
 * result now, then those the commit daemon selected, once it queued them
 * (R1).
 */
async function queueBoth(
  input: CallInput,
  side: {
    readonly daemons: AtDaemons;
    readonly commit: CommitDaemonInput;
    readonly now: NowSide;
    readonly bound: number;
    readonly askBy: number;
    readonly run: NonNullable<AtArgs["run"]>;
  },
): Promise<[CommitAsked, SideQueue]> {
  const { root, commit, paths } = input.place;
  const { daemons, bound, askBy, now } = side;
  const changed = await changedPaths(root, commit);
  const owner = randomUUID();
  const withoutNow = now.refs.filter((ref) => now.state(ref).state === "no result");
  const named = (ref: TestFileRef) => paths !== null && selects(paths, ref.path);
  const first = side.run.allMissing
    ? withoutNow
    : withoutNow.filter((ref) => changed.includes(ref.path) || named(ref));
  let selected: (files: readonly TestFileRef[]) => void = () => {};
  const later = new Promise<readonly TestFileRef[]>((resolve) => {
    selected = resolve;
  });
  const atPaths = new Set<string>();
  const queue = {
    daemons,
    deadline: bound,
    askBy: () => askBy,
    call: { owner, lead: paths !== null },
    ask: true,
    files: first,
  };
  return Promise.all([
    askCommit({
      daemons,
      commit: side.commit,
      owner,
      changed,
      named: paths ?? [],
      allMissing: side.run.allMissing,
      askBy,
      deadline: bound,
      queued: (files) => {
        for (const ref of files) atPaths.add(ref.path);
        selected(withoutNow.filter((ref) => atPaths.has(ref.path)));
      },
    }).finally(() => selected([])),
    worktreeTwice(queue, root, later),
  ]);
}

/** D4.5's input: the paths `<commit>..HEAD` changes and the working tree's changes since HEAD. */
async function changedPaths(root: AbsolutePath, commit: string): Promise<RelativePath[]> {
  const out = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"]);
  const committed = out.split("\0").filter((path) => path !== "") as RelativePath[];
  return [...new Set([...committed, ...((await uncommitted(root)) ?? [])])];
}

/**
 * `--wait` alone: the commit worktree that serves this commit and
 * environment, or the one that did, gone now, whose daemon's rows the
 * store still holds; `null` when neither.
 */
async function joinedTree(
  daemons: AtDaemons,
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  return daemons.find(input) ?? (await formerTree(input, commonDir));
}

/** `--wait` alone, the commit side: the daemon's asks and the call's files it lists pending. */
async function joinedCommit(
  daemons: AtDaemons,
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
  paths: readonly RelativePath[] | null,
  bound: number,
): Promise<CommitAsked> {
  const tree = await joinedTree(daemons, input, commonDir);
  if (tree === null) return joinCommit(daemons, null, bound);
  const listed = await withStores(commonDir, async (main) =>
    (main?.testFileKeys.list(idOf(tree)) ?? [])
      .filter((row) => row.pending !== null && row.pending !== undefined)
      .map((row) => row.testFile)
      .filter((ref) => paths === null || selects(paths, ref.path)),
  );
  return joinCommit(daemons, tree, bound, listed);
}

/** The report's part for the call (D7.3, Q7). */
function queuedRun(
  input: CallInput,
  waitMs: number,
  [atQueue, nowQueue]: readonly [CommitAsked, SideQueue],
  after: { readonly at: CommitSide; readonly current: NowSide },
  queue: boolean,
): QueuedRun {
  const finite = Number.isFinite(waitMs);
  return {
    mode: queue ? "queue" : "join",
    waitMs: finite ? waitMs : null,
    usedMs: Date.now() - input.startedMs,
    commit: { ...queuedSide(atQueue, after.at.state), tree: atQueue.root, setup: setupOf(atQueue) },
    notSelected: notSelectedOf(after.at),
    now: queuedSide(nowQueue, after.current.state),
    again: finite ? waitAgain(input.args.commit, input.args.paths) : null,
    retry:
      atQueue.late === true || nowQueue.late === true
        ? runAgain(input.args.commit, input.args.paths)
        : null,
  };
}

/** Row 023-40c: what the commit daemon still sets up when the wait ends; `null` when none. */
function setupOf(queue: CommitAsked): "install" | "starting" | "selecting" | null {
  const { setup } = queue;
  if (setup === null || setup.phase === "failed") return null;
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

/** Both sides read again once the waits ended: the commit side at its daemon's live keys. */
async function readAfter(
  input: CallInput,
  atQueue: CommitAsked,
  nowQueue: SideQueue,
  selection: boolean,
): Promise<{
  readonly at: CommitSide;
  readonly current: NowSide;
  readonly refs: readonly TestFileRef[];
  readonly unmatched: readonly RelativePath[];
}> {
  const { read, place } = input;
  const { root, commit, paths, worktreeId } = place;
  const fresh = await withStores(place.commonDir, (main) => nowSide({ ...read, main }));
  return withStores(place.commonDir, async (main) => {
    const rows = { root, commit, paths, own: worktreeId, asked: atQueue, selection };
    const { at: live } = await rowsSide(main, rows);
    const sides = { now: fresh.sources, at: live.sources, failed: false };
    const { refs, unmatched } = unionRefs(fresh.refs, live.refs, paths, sides, root, commit);
    // The store closes after this read: each file's state is read now, not later.
    const fixed = new Map(
      [...refs, ...atQueue.files].map((ref) => [testFileId(ref), live.state(ref)]),
    );
    const at = {
      ...live,
      state: (ref: TestFileRef) => fixed.get(testFileId(ref)) ?? live.state(ref),
    };
    const current = await listLate(read, fresh, refs);
    const state = nowAfter(main, current.state, nowQueue);
    return { at, current: { ...current, state }, refs, unmatched };
  });
}

/** A commit worktree of this commit and environment whose tree is gone, if the store still holds its daemon's rows. */
async function formerTree(
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  const name = commitFolderName(input.commit, environmentFingerprint(input.environment));
  const cacheRoot = input.cacheRoot ?? cacheCheckoutsRoot();
  const dirs = [cacheCheckoutsDir(cacheRoot, commonDir), gitCheckoutsDir(commonDir)];
  const trees = dirs.map((dir) => treePath(join(dir, name)));
  return withStores(commonDir, async (main) => {
    if (main === null) return null;
    return trees.find((tree) => main.testFileKeys.list(idOf(tree)).length > 0) ?? null;
  });
}

/**
 * D4.5, Q7: a large selection tells its estimate once, as it is queued,
 * with how to narrow it; `--all-missing` always does (D17.1).
 */
function tellEstimate(
  files: readonly TestFileRef[],
  args: AtArgs,
  waitMs: number,
  root: AbsolutePath,
  commit: string,
  note: (text: string) => void,
): void {
  if (files.length === 0) return;
  const durations = storedDurations(root);
  try {
    const estimate = estimateOf(
      files.map((ref) => ({ ref })),
      (ref) => durations?.of(ref) ?? null,
    );
    const allMissing = args.run?.allMissing === true;
    if (!tellsEstimate(estimate, allMissing, waitMs / 1000)) return;
    const at = commit.slice(0, 9);
    const { seconds } = estimate;
    const time =
      seconds === null
        ? "no stored duration, so the time is unknown"
        : `about ${seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`} at this machine's rate`;
    const narrow = allMissing
      ? ""
      : `; name test files or folders to narrow it: squeal status --at ${args.commit} <path>... --run`;
    note(
      `${allMissing ? "--all-missing" : "--run"}: ${estimate.files} test files with no result at ${at} queued in its commit daemon, up to ${estimate.width} at once: ${time}; they run on after the wait${narrow}`,
    );
  } finally {
    durations?.close();
  }
}

/** D7.1: the commit's own `env.allowlist`, which its daemon reads; none when it has no such config. */
async function commitAllowlist(root: AbsolutePath, commit: string): Promise<readonly string[]> {
  try {
    const text = await runGit(root, ["show", `${commit}:squeal.config.json`]);
    const list = (JSON.parse(text) as { env?: { allowlist?: unknown } }).env?.allowlist;
    return Array.isArray(list) ? list.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/** The allow-listed variables `env` sets: what a daemon puts in its environment hash. */
export function environmentOf(
  allowlist: readonly string[],
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of allowlist) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** `value` without its `undefined` fields (`exactOptionalPropertyTypes`). */
function defined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
