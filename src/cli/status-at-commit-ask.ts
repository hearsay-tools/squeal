import { setTimeout as sleep } from "node:timers/promises";
import { selects } from "../core/commit/at-keys-narrow.js";
import { changeOf } from "../core/daemon/at-asks.js";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { CommitAskState, CommitSetup } from "../core/types/commit-ask.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { AtDaemons, CommitDaemonInput } from "./status-at-daemons.js";
import { NOTHING, type SideQueue, unreached } from "./status-at-queue.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c, the human: "A: daemon
 * owns setup"): the commit side of a `status --at --run` call. The call
 * makes the commit worktree (no install), starts its daemon, sends it one
 * ask (the change, the named paths, `--all-missing`), then reads the ask
 * back until the daemon queued its files, and waits for them as `run
 * <group> --wait` does. It installs nothing and keys nothing at the
 * commit. Each step ends by the call's bound: what is not done then is
 * reported as it stands ("still setting up at <c> (install)") and goes on
 * in the daemon. `--wait` without `--run` reads the asks the daemon keeps
 * and waits for their files; it asks and starts nothing.
 */

/** How often the call reads an ask back until the daemon queued its files. */
const READ_EVERY_MS = 250;

/** The commit side's queue, with the daemon's setup and the ask as last read. */
export interface CommitAsked extends SideQueue {
  /** The commit daemon's setup; `null` when none was reached or read. */
  readonly setup: CommitSetup | null;
  /** T2: per node:test project, its files with an incomplete static closure, as the daemon told. */
  readonly incomplete?: Readonly<Record<string, readonly RelativePath[]>>;
  /** The asks read (the call's own with `--run`, every kept one with `--wait`). */
  readonly asks: readonly CommitAskState[];
  /** Review 0.1.599 B4: the identity of this call's change (`changeOf`); `null`: not known. */
  readonly change: string | null;
  /** Review 0.1.599 B2: `--wait` alone, the readers of its named paths the commit daemon told. */
  readonly readers?: ReadonlyMap<RelativePath, readonly TestFileRef[]>;
}

/** Each file's group, as the commit's own policy places it (R3's setup line names it). */
function groupsOf(tree: AbsolutePath): (ref: TestFileRef) => string {
  const view = groupView(readPolicy(tree));
  return (ref) => view.of(ref).name;
}

/** No commit daemon was reached: nothing was asked. */
function notReached(problem: string, late: boolean): CommitAsked {
  return { ...unreached([], problem, late), setup: null, asks: [], change: null };
}

export interface AskInput {
  readonly daemons: AtDaemons;
  readonly commit: CommitDaemonInput;
  readonly owner: string;
  readonly changed: readonly RelativePath[];
  readonly named: readonly RelativePath[];
  readonly allMissing: boolean;
  /** Epoch ms by which the worktree, the start and every request end (the call's `askBy`). */
  readonly askBy: number;
  /** Epoch ms when the reads and the wait end (the call's wait less its report reserve). */
  readonly deadline: number;
  /** Told the ask's files once the daemon queued them (R1: the working tree runs them too). */
  readonly queued?: (files: readonly TestFileRef[]) => void;
}

/** `--run`: the commit worktree and its daemon, one ask, its reads, then the wait for its files. */
export async function askCommit(input: AskInput): Promise<CommitAsked> {
  const { daemons, askBy, deadline, owner } = input;
  const tree = await daemons.commit({ ...input.commit, deadline: askBy });
  if (typeof tree !== "string") return notReached(tree.problem, Date.now() >= askBy);
  const ask = {
    owner,
    changed: input.changed,
    named: input.named,
    allMissing: input.allMissing,
    // D4.9: an input generated in the caller's worktree counts as one git does not hold.
    root: input.commit.root,
  };
  const refused = await daemons.commitAsk(tree, ask, askBy).catch((error) => String(error));
  if (refused !== null) return { ...notReached(refused, false), root: tree };
  const read = await readUntilQueued(daemons, tree, [owner], askBy, deadline);
  const own = read.asks.find((a) => a.owner === owner);
  input.queued?.(own?.phase === "queued" ? own.files : []);
  return { ...(await waitFor(daemons, tree, read, deadline)), change: changeOf(input.changed) };
}

/** What `--wait` alone joins at the commit, beside the daemon's kept asks. */
export interface CommitJoin {
  /** The files the daemon lists pending; the call's paths narrow them here. */
  readonly listed: readonly TestFileRef[];
  /** The call's paths; `null` for every file. */
  readonly paths: readonly RelativePath[] | null;
  /** Of `paths`, those that select no test file the daemon lists: their readers are asked. */
  readonly sources: readonly RelativePath[];
  /** Review 0.1.599 B4: the identity of this call's change (`changeOf`); `null`: not known. */
  readonly change: string | null;
  /** Epoch ms by which the readers' query ends (the call's `askBy`). */
  readonly askBy: number;
}

/**
 * `--wait` alone: the asks the commit daemon at `tree` keeps and the
 * call's files it lists pending (`listed`), joined; nothing is asked or
 * started.
 */
export async function joinCommit(
  daemons: AtDaemons,
  tree: AbsolutePath | null,
  bound: number,
  join: CommitJoin = { listed: [], paths: null, sources: [], change: null, askBy: bound },
): Promise<CommitAsked> {
  if (tree === null) return { ...NOTHING, setup: null, asks: [], change: join.change };
  const read = await readUntilQueued(daemons, tree, undefined, bound, bound);
  const readers = await readersAt(daemons, tree, read, join);
  const keep = keeper(join.paths, read, readers);
  const asks = read.asks.map((ask) => ({ ...ask, files: ask.files.filter(keep) }));
  const joined = await waitFor(daemons, tree, { ...read, asks }, bound, join.listed.filter(keep));
  return { ...joined, change: join.change, readers };
}

/**
 * Review 0.1.599 B2: the readers of the call's paths that are no test file,
 * from the commit daemon's own key index (its `sync` with the paths, as the
 * working tree's side asks its daemon); it queues nothing. An earlier wide
 * ask named no path and kept no readers, so a narrowed `--wait` cannot read
 * them there. None while the daemon sets up: it has queued nothing yet.
 */
async function readersAt(
  daemons: AtDaemons,
  tree: AbsolutePath,
  read: Read,
  join: CommitJoin,
): Promise<ReadonlyMap<RelativePath, readonly TestFileRef[]>> {
  if (join.sources.length === 0 || read.setup?.phase !== "ready") return new Map();
  const asked = await daemons.now(tree, join.sources, join.askBy).catch(() => null);
  return asked?.kind === "read" ? (asked.readers ?? new Map()) : new Map();
}

/**
 * Row 023-51 (V4): a narrowed `--wait` joins only the files its paths
 * select, by path or as a named path's readers (the daemon's, review
 * 0.1.599 B2, and those an ask kept), so it waits for and counts its own
 * files, not another call's whole queue.
 */
function keeper(
  paths: readonly RelativePath[] | null,
  read: Read,
  readers: ReadonlyMap<RelativePath, readonly TestFileRef[]>,
): (ref: TestFileRef) => boolean {
  if (paths === null) return () => true;
  const kept = read.asks.flatMap((ask) => paths.flatMap((path) => ask.readers[path] ?? []));
  const ids = new Set([...kept, ...[...readers.values()].flat()].map(testFileId));
  return (ref) => selects(paths, ref.path) || ids.has(testFileId(ref));
}

export interface Read {
  readonly setup: CommitSetup | null;
  readonly asks: readonly CommitAskState[];
  readonly problem: string | null;
  readonly incomplete?: Readonly<Record<string, readonly RelativePath[]>>;
}

/**
 * Reads the asks of `owners` until each is queued or failed, or
 * `deadline`; the last read. Each read ends by `askBy`, so one read is
 * made even when the wait is over.
 */
export async function readUntilQueued(
  daemons: AtDaemons,
  tree: AbsolutePath,
  owners: readonly string[] | undefined,
  askBy: number,
  deadline: number,
): Promise<Read> {
  for (;;) {
    const answer = await daemons.commitRead(tree, owners, askBy).catch((error) => String(error));
    if (typeof answer === "string") return { setup: null, asks: [], problem: answer };
    const settled = answer.asks.every((a) => a.phase === "queued" || a.phase === "failed");
    const over = answer.setup.phase === "failed" || answer.setup.phase === "changed";
    if (settled || over || Date.now() >= deadline)
      return {
        setup: answer.setup,
        asks: answer.asks,
        problem: null,
        ...(answer.incomplete === undefined ? {} : { incomplete: answer.incomplete }),
      };
    await sleep(Math.min(READ_EVERY_MS, Math.max(0, deadline - Date.now())));
  }
}

/** The queued asks' files, waited for until none is pending or `bound`. */
async function waitFor(
  daemons: AtDaemons,
  tree: AbsolutePath,
  read: Read,
  bound: number,
  listed: readonly TestFileRef[] = [],
): Promise<Omit<CommitAsked, "change">> {
  const files = new Map<string, TestFileRef>();
  const pending = new Set<string>();
  const problems: string[] = read.problem === null ? [] : [read.problem];
  for (const ask of read.asks) {
    if (ask.phase === "failed") problems.push(ask.text ?? "the ask failed");
    problems.push(...ask.problems);
    for (const ref of ask.files) files.set(testFileId(ref), ref);
  }
  for (const ref of listed) files.set(testFileId(ref), ref);
  const queued = [
    ...new Map(
      [...read.asks.filter((a) => a.phase === "queued").flatMap((a) => a.files), ...listed].map(
        (ref) => [testFileId(ref), ref],
      ),
    ).values(),
  ];
  if (queued.length > 0) {
    const ended = await daemons.wait(tree, queued, bound).catch((error: unknown) => String(error));
    if (ended !== null) problems.push(ended);
  }
  // An ask not queued yet still runs once the daemon's setup allows: its files count as queued.
  for (const ask of read.asks)
    if (ask.phase === "waiting" || ask.phase === "selecting")
      for (const ref of ask.files) pending.add(testFileId(ref));
  return {
    root: tree,
    files: [...files.values()],
    pending,
    problems: [...new Set(problems)],
    groupOf: groupsOf(tree),
    setup: read.setup,
    ...(read.incomplete === undefined ? {} : { incomplete: read.incomplete }),
    asks: read.asks,
  };
}
