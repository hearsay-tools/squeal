import { withStores } from "../core/commit/at-keys-checkout.js";
import { readPolicy } from "../core/daemon/policy.js";
import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { CliIo } from "./main.js";
import type { AtArgs, AtOptions } from "./status-at.js";
import { idOf, nowAfter } from "./status-at-after.js";
import { assembleReport } from "./status-at-assemble.js";
import { type After, queuedRun, restOf } from "./status-at-call-run.js";
import { joinedCommit, queueBoth } from "./status-at-call-sides.js";
import type { CommitAsked } from "./status-at-commit-ask.js";
import { joinSelects, rowsSide } from "./status-at-commit-rows.js";
import { type CommitDaemonInput, realDaemons } from "./status-at-daemons.js";
import { joinNow } from "./status-at-join.js";
import { type NowPlace, type NowRead, nowAgain, worktreeNow } from "./status-at-now-ask.js";
import { RECORD_WAIT_MS, type SideQueue } from "./status-at-queue.js";
import { unionRefs } from "./status-at-refs.js";
import { exitCode, formatAt, jsonAt } from "./status-at-report.js";
import { RUN_WAIT_MS } from "./status-at-report-queued.js";
import { selectsOf } from "./status-at-report-scope.js";

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
  // Review wave-23-third B1 (D7.3 as amended 2026-11-22): the working tree's side is asked of its
  // daemon, started when none runs, by the call's `askBy`; the call keys nothing there.
  const nowPlace: NowPlace = {
    daemons,
    root,
    commonDir,
    worktreeId: place.worktreeId,
    paths: place.paths,
  };
  const nowRead = worktreeNow(nowPlace, askBy, run !== null);
  const [atQueue, nowQueue] =
    run === null
      ? await Promise.all([
          joinedCommit(daemons, commitInput, commonDir, place.paths, { bound, askBy }),
          nowRead.then(({ side }) =>
            joinNow({ daemons, root, refs: side.refs, now: side.state, deadline: bound }),
          ),
        ])
      : await queueBoth(input, { daemons, commit: commitInput, now: nowRead, bound, askBy, run });
  const first = await nowRead;
  const after = await readAfter(input, atQueue, nowQueue, run !== null, nowPlace, first);
  const report = await assembleReport({
    root,
    commit,
    refs: after.refs,
    unmatched: after.unmatched,
    current: after.current,
    // Review wave-23 S2: Q1's step was read before the wait; the call's own lines say what is next.
    side: { at: after.at, probe: null, state: after.at.state },
    queued: queuedRun(input, waitMs, [atQueue, nowQueue], after, run !== null),
    // Row 023-53 (V8): a narrowed call's counts say what they cover.
    scope: {
      given: args.commit,
      paths: args.paths,
      selects: selectsOf(atQueue.asks, atQueue.change),
    },
  });
  io.stdout(args.json ? jsonAt(report) : formatAt(report, input.startedMs, args.full === true));
  // A side its daemon did not answer is not known, even with no file to list.
  const answered =
    after.current.source.kind !== "setting up" && after.current.source.kind !== "unserved";
  return after.unmatched.length === 0 && answered ? exitCode(report.files) : 3;
}

/** Both sides read again once the waits ended: the commit side at its daemon's live keys. */
async function readAfter(
  input: CallInput,
  atQueue: CommitAsked,
  nowQueue: SideQueue,
  selection: boolean,
  nowPlace: NowPlace,
  first: NowRead,
): Promise<After & { readonly unmatched: readonly RelativePath[] }> {
  const { place } = input;
  const { root, commit, paths, worktreeId } = place;
  // Review wave-23-third B1: the daemon's rows again, never a keying here.
  const fresh = await nowAgain(nowPlace, first);
  const unread = first.asked.kind !== "read";
  return withStores(place.commonDir, async (main) => {
    // Row 023-61 (W5): `--wait` alone keeps the categories of the wide `--run` it joins.
    const chose = selection || joinSelects(atQueue);
    const rows = { root, commit, paths, own: worktreeId, asked: atQueue, selection: chose };
    const { at: live } = await rowsSide(main, rows);
    // A side not read cannot say a named path selects nothing: each is answered as a file.
    const sides = { now: fresh.sources, at: live.sources, failed: unread };
    const { refs, unmatched } = unionRefs(fresh.refs, live.refs, paths, sides, root, commit);
    // The store closes after this read: each file's state is read now, not later.
    const fixed = new Map(
      [...refs, ...atQueue.files].map((ref) => [testFileId(ref), live.state(ref)]),
    );
    const at = {
      ...live,
      state: (ref: TestFileRef) => fixed.get(testFileId(ref)) ?? live.state(ref),
    };
    const state = nowAfter(main, fresh.state, nowQueue);
    // Row 023-51 (V4): each daemon's queue outside the call's files, counted apart.
    const narrowed = paths !== null;
    const atRoot = atQueue.root === null ? null : idOf(atQueue.root);
    const rest = {
      commit: restOf(main, atRoot, narrowed ? refs : atQueue.files),
      now: restOf(main, worktreeId, narrowed ? refs : nowQueue.files),
    };
    // Row 023-59 (W2): a join names what went from running to a result; it read both sides first.
    const began = selection ? {} : { began: beganOf(atQueue, first) };
    return { at, current: { ...fresh, state }, refs, unmatched, rest, ...began };
  });
}

/** Row 023-59 (W2): per side, the call's files queued or running as a `--wait` began. */
function beganOf(atQueue: CommitAsked, first: NowRead): NonNullable<After["began"]> {
  const { side } = first;
  const now = side.refs.filter((ref) => {
    const s = side.state(ref);
    return s.state === "no result" && s.pending !== undefined && s.pending !== "setting up";
  });
  return { commit: atQueue.began ?? [], now };
}

/**
 * D7.1: the commit's own `env.allowlist`, which its daemon reads; none when it has no such config.
 * With `timeoutMs` (row 023-42, review 0.1.597 B3), a read that does not end by then rejects:
 * an allowlist not read is no empty one, whose fingerprint names another commit worktree.
 */
export async function commitAllowlist(
  root: AbsolutePath,
  commit: string,
  timeoutMs?: number,
): Promise<readonly string[]> {
  if (timeoutMs !== undefined && timeoutMs <= 0)
    throw new Error("no time left to read the commit's squeal.config.json");
  const started = performance.now();
  let text: string;
  try {
    const bound = timeoutMs === undefined ? {} : { timeoutMs };
    text = await runGit(root, ["show", `${commit}:squeal.config.json`], bound);
  } catch (error) {
    if (timeoutMs !== undefined && performance.now() - started >= timeoutMs) throw error;
    return [];
  }
  try {
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
