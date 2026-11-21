import { setTimeout as sleep } from "node:timers/promises";
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
  /** The asks read (the call's own with `--run`, every kept one with `--wait`). */
  readonly asks: readonly CommitAskState[];
}

/** Each file's group, as the commit's own policy places it (R3's setup line names it). */
function groupsOf(tree: AbsolutePath): (ref: TestFileRef) => string {
  const view = groupView(readPolicy(tree));
  return (ref) => view.of(ref).name;
}

/** No commit daemon was reached: nothing was asked. */
function notReached(problem: string, late: boolean): CommitAsked {
  return { ...unreached([], problem, late), setup: null, asks: [] };
}

export interface AskInput {
  readonly daemons: AtDaemons;
  readonly commit: CommitDaemonInput;
  readonly owner: string;
  readonly changed: readonly RelativePath[];
  readonly named: readonly RelativePath[];
  readonly allMissing: boolean;
  /** Epoch ms by which every request ends (the call's deadline less its report reserve). */
  readonly bound: number;
  /** Told the ask's files once the daemon queued them (R1: the working tree runs them too). */
  readonly queued?: (files: readonly TestFileRef[]) => void;
}

/** `--run`: the commit worktree and its daemon, one ask, its reads, then the wait for its files. */
export async function askCommit(input: AskInput): Promise<CommitAsked> {
  const { daemons, bound, owner } = input;
  const tree = await daemons.commit({ ...input.commit, deadline: bound });
  if (typeof tree !== "string") return notReached(tree.problem, Date.now() >= bound);
  const ask = { owner, changed: input.changed, named: input.named, allMissing: input.allMissing };
  const refused = await daemons.commitAsk(tree, ask, bound).catch((error) => String(error));
  if (refused !== null) return { ...notReached(refused, false), root: tree };
  const read = await readUntilQueued(daemons, tree, [owner], bound);
  const own = read.asks.find((a) => a.owner === owner);
  input.queued?.(own?.phase === "queued" ? own.files : []);
  return waitFor(daemons, tree, read, bound);
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
  listed: readonly TestFileRef[] = [],
): Promise<CommitAsked> {
  if (tree === null) return { ...NOTHING, setup: null, asks: [] };
  const read = await readUntilQueued(daemons, tree, undefined, bound);
  return waitFor(daemons, tree, read, bound, listed);
}

interface Read {
  readonly setup: CommitSetup | null;
  readonly asks: readonly CommitAskState[];
  readonly problem: string | null;
}

/** Reads the asks of `owners` until each is queued or failed, or `bound`; the last read. */
async function readUntilQueued(
  daemons: AtDaemons,
  tree: AbsolutePath,
  owners: readonly string[] | undefined,
  bound: number,
): Promise<Read> {
  for (;;) {
    const answer = await daemons.commitRead(tree, owners, bound).catch((error) => String(error));
    if (typeof answer === "string") return { setup: null, asks: [], problem: answer };
    const settled = answer.asks.every((a) => a.phase === "queued" || a.phase === "failed");
    if (settled || answer.setup.phase === "failed" || Date.now() >= bound)
      return { setup: answer.setup, asks: answer.asks, problem: null };
    await sleep(Math.min(READ_EVERY_MS, Math.max(0, bound - Date.now())));
  }
}

/** The queued asks' files, waited for until none is pending or `bound`. */
async function waitFor(
  daemons: AtDaemons,
  tree: AbsolutePath,
  read: Read,
  bound: number,
  listed: readonly TestFileRef[] = [],
): Promise<CommitAsked> {
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
    ...read.asks.filter((a) => a.phase === "queued").flatMap((a) => a.files),
    ...listed,
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
    asks: read.asks,
  };
}
