import { randomUUID } from "node:crypto";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { readPolicy } from "../core/daemon/policy.js";
import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import type { CliIo } from "./main.js";
import type { AtArgs, AtOptions } from "./status-at.js";
import { commitAfter, nowAfter } from "./status-at-after.js";
import { assembleReport } from "./status-at-assemble.js";
import { type CommitRun, commitRun } from "./status-at-commit-run.js";
import { type CommitDaemonInput, realDaemons } from "./status-at-daemons.js";
import { joinBoth } from "./status-at-join.js";
import { listLate, type NowInput, type NowSide, nowSide } from "./status-at-now.js";
import { askBound, commitQueue, type SideQueue, worktreeQueue } from "./status-at-queue.js";
import { unionRefs } from "./status-at-refs.js";
import { rekeyGrown } from "./status-at-rekey.js";
import { exitCode, formatAt, jsonAt, type SideState } from "./status-at-report.js";
import {
  type QueuedRun,
  queuedSide,
  RUN_WAIT_MS,
  runAgain,
  waitAgain,
} from "./status-at-report-queued.js";
import { estimateOf, tellsEstimate } from "./status-at-run-batches.js";
import { commitSelect, type Selected } from "./status-at-select.js";

/*
 * Spec 023 D7.3 (row 023-40): `status --at <commit> --run [--wait [<ms>]]`
 * and `status --at <commit> --wait [<ms>]`. With `--run`, the commit's
 * keys and D4.5's selection come from a temporary checkout as before (D2),
 * then the selected files are queued in the commit daemon (its worktree
 * made and its daemon started when none serves it) and the working tree's
 * selected files in this worktree's daemon (started when none runs), each
 * with one narrow request per group, the named files first. The call waits
 * up to 100 s by default (`--wait <ms>` sets it, a bare `--wait` waits
 * until done) as `run <group> --wait` does, then reports what is known;
 * what still runs goes on in the daemons and Q7's line says so. `--wait`
 * without `--run` joins what the daemons already queued and starts none.
 */

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
  const { root, commonDir, commit, paths } = place;
  const run = args.run ?? null;
  const waitMs = args.waitMs ?? (run === null ? 0 : RUN_WAIT_MS);
  const note = (text: string) =>
    io.stderr(text.startsWith("squeal: ") ? `${text}\n` : `squeal: ${text}\n`);
  const { chosen, side } = await commitKeys(input, note);
  const sides = { now: input.now.sources, at: side.at.sources, failed: side.at.failure !== null };
  const { refs, unmatched } = unionRefs(input.now.refs, side.at.refs, paths, sides, root, commit);
  const listed = await listLate(input.read, input.now, refs);
  const commitInput: CommitDaemonInput = {
    root,
    commit,
    environment: environmentOf(await commitAllowlist(root, commit), input.env),
    note,
    ...defined({
      limit: readPolicy(root).daemon.maxCommitDaemons ?? undefined,
      cacheRoot: options.cacheRoot,
      placeWaitMs: options.placeWaitMs,
      install: options.install,
    }),
  };
  const daemons = options.daemons ?? realDaemons({ note });
  // Review wave-23 B1: one deadline for the whole call, counted from its start.
  const deadline = input.startedMs + waitMs;
  const queue = {
    daemons,
    deadline,
    askBy: askBound(deadline),
    call: { owner: randomUUID(), lead: paths !== null },
    ask: run !== null,
  };
  let queues: [SideQueue, SideQueue];
  if (chosen !== null) {
    // A checkout whose files git's rules or the install changed gives no key of the commit's
    // (row 023-07): nothing from it is queued, and its files stay not comparable.
    const comparable = chosen.at.changed === null;
    const atFiles = comparable ? (chosen.selection?.run.map((file) => file.ref) ?? []) : [];
    const selects = chosen.selection?.selects;
    const nowFiles = selects === undefined ? [] : selectedNow(refs, listed.state, selects);
    tellEstimate(atFiles, args, waitMs, root, commit, note);
    queues = await Promise.all([
      commitQueue({ ...queue, files: atFiles }, commitInput),
      worktreeQueue({ ...queue, files: nowFiles }, root),
    ]);
  } else {
    // Review wave-23 B2: also the requests the daemons recorded and have not taken yet.
    queues = await joinBoth({
      daemons,
      commit: commitInput,
      refs,
      at: side.state,
      now: listed.state,
      root,
      commonDir,
      deadline: queue.deadline,
      askBy: queue.askBy,
    });
  }
  // Review wave-23 B3: a run that observed new inputs stored at their key; key those files again (D2).
  const checkout = defined({ cacheRoot: options.cacheRoot, install: options.install });
  const rekey = { ...place, env: input.env, note, options: checkout };
  const keyed = await rekeyGrown(rekey, side.state, queues[0]);
  const after = await readAfter(input, refs, keyed, ...queues);
  const report = await assembleReport({
    root,
    commit,
    refs,
    unmatched,
    current: after.current,
    // Review wave-23 S2: Q1's step was read before the wait; the call's own lines say what is next.
    side: { ...side, probe: null, state: after.at },
    part: null,
    queued: queuedRun(input, waitMs, queues, after, chosen),
  });
  io.stdout(args.json ? jsonAt(report) : formatAt(report, input.startedMs, args.full === true));
  return side.at.failure === null && unmatched.length === 0 ? exitCode(report.files) : 3;
}

/** The commit side's keys: with `--run`, with D4.5's selection; else as without it, with Q1's probe. */
async function commitKeys(
  input: CallInput,
  note: (text: string) => void,
): Promise<{
  readonly chosen: Selected | null;
  readonly side: Pick<CommitRun, "at" | "ran" | "probe" | "state">;
}> {
  const { args, place, options, io } = input;
  const { root, worktreeId, commit, paths } = place;
  const select = { root, worktreeId, commit, paths, env: input.env, note };
  const checkout = defined({ cacheRoot: options.cacheRoot, install: options.install });
  const run = args.run ?? null;
  if (run !== null) {
    const chosen = await commitSelect({ ...select, allMissing: run.allMissing, options: checkout });
    return { chosen, side: { at: chosen.at, ran: null, probe: null, state: chosen.state } };
  }
  const side = await commitRun({
    ...select,
    commonDir: place.commonDir,
    given: args.commit,
    givenPaths: args.paths,
    run: null,
    relaunch: io.relaunch,
    forward: () => undefined,
    options: checkout,
  });
  return { chosen: null, side };
}

/** The report's part for the call (D7.3, Q7). */
function queuedRun(
  input: CallInput,
  waitMs: number,
  [atQueue, nowQueue]: readonly [SideQueue, SideQueue],
  after: { readonly at: (ref: TestFileRef) => SideState; readonly current: NowSide },
  chosen: Selected | null,
): QueuedRun {
  const finite = Number.isFinite(waitMs);
  return {
    mode: chosen === null ? "join" : "queue",
    waitMs: finite ? waitMs : null,
    usedMs: Date.now() - input.startedMs,
    commit: { ...queuedSide(atQueue, after.at), tree: atQueue.root },
    notSelected: chosen?.selection?.unselected?.size ?? 0,
    now: queuedSide(nowQueue, after.current.state),
    again: finite ? waitAgain(input.args.commit, input.args.paths) : null,
    retry:
      atQueue.late === true || nowQueue.late === true
        ? runAgain(input.args.commit, input.args.paths)
        : null,
  };
}

/** Both sides read again once the wait ended. */
async function readAfter(
  input: CallInput,
  refs: readonly TestFileRef[],
  keyed: (ref: TestFileRef) => SideState,
  atQueue: SideQueue,
  nowQueue: SideQueue,
): Promise<{ readonly at: (ref: TestFileRef) => SideState; readonly current: NowSide }> {
  const { read, place } = input;
  const fresh = await withStores(place.commonDir, (main) => nowSide({ ...read, main }));
  const current = await listLate(read, fresh, refs);
  return withStores(place.commonDir, async (main) => ({
    at: commitAfter(main, keyed, atQueue, place.worktreeId),
    current: { ...current, state: nowAfter(main, current.state, nowQueue) },
  }));
}

/** R1: the files of `refs` the change selects that have no result in the working tree. */
function selectedNow(
  refs: readonly TestFileRef[],
  state: (ref: TestFileRef) => SideState,
  selects: { readonly ids: ReadonlySet<string> | null; readonly paths: ReadonlySet<string> },
): TestFileRef[] {
  return refs.filter((ref) => {
    if (state(ref).state !== "no result") return false;
    return selects.ids === null || selects.ids.has(testFileId(ref)) || selects.paths.has(ref.path);
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
