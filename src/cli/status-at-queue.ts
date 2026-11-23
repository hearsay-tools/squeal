import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { AtDaemons, CommitDaemonInput, NarrowCall } from "./status-at-daemons.js";

/*
 * Spec 023 D7.3 (row 023-40): one side of a `status --at --run` call in its
 * daemon. One narrow request per group of the side's own policy, the
 * files the call names first (`lead`), then the wait of `run <group>
 * --wait` until none of the files is pending or the deadline. A request
 * the daemon recorded and had not taken by then still runs: the daemon
 * takes it once its start allows. Without `--run` (`--wait` alone) nothing
 * is asked: the wait joins what the daemon already queued.
 */

/** What one side's daemon was asked and how the wait ended. */
export interface SideQueue {
  /** The daemon's root (the commit worktree's tree, or the user's worktree); `null`: none was reached. */
  readonly root: AbsolutePath | null;
  /** The files the call queued there (or, with `--wait` alone, joined). */
  readonly files: readonly TestFileRef[];
  /** The `testFileId`s whose request the daemon recorded and had not taken at the end. */
  readonly pending: ReadonlySet<string>;
  /** Why the daemon gave no answer for some files: a request, the wait, or the daemon's start. */
  readonly problems: readonly string[];
  /** Each file's group, as the side's own policy places it. */
  readonly groupOf: (ref: TestFileRef) => string;
  /** Review wave-23 B1: the call's wait ended before its daemon could be asked. */
  readonly late?: boolean;
  /** Row 023-40c: the files the daemon took, when the side was asked with `waits: false`. */
  readonly taken?: readonly TestFileRef[];
}

const NO_GROUP = () => "";

/**
 * A request is asked at least this long after the call's start, so it is
 * recorded even when the wait is shorter (`--wait 0`). Review wave-23 B1,
 * row 023-40c: once per call, shared by every step on both sides.
 */
export const RECORD_WAIT_MS = 10_000;

/** A side whose daemon was never reached: its files run nowhere, `problem` says why. */
export function unreached(files: readonly TestFileRef[], problem: string, late = false): SideQueue {
  const side = { root: null, files, pending: new Set<string>(), problems: [problem] };
  return { ...side, groupOf: NO_GROUP, ...(late ? { late } : {}) };
}

/** A side with nothing to queue or join. */
export const NOTHING: SideQueue = {
  root: null,
  files: [],
  pending: new Set(),
  problems: [],
  groupOf: NO_GROUP,
};

export interface QueueInput {
  readonly daemons: AtDaemons;
  readonly files: readonly TestFileRef[];
  /** Epoch ms; `Infinity` for a bare `--wait`. */
  readonly deadline: number;
  /** The bound every start and request of the call shares (the call's `askBy`). */
  readonly askBy: () => number;
  readonly call: NarrowCall;
  /** `false` for `--wait` without `--run`: join, ask nothing. */
  readonly ask: boolean;
  /** Row 023-40c: `false` asks and does not wait; the caller waits once over every step's files. */
  readonly waits?: false;
  /** Review wave-23-third B1: the call already started the daemon and it answered; no start here. */
  readonly started?: true;
}

/** The commit side: its worktree and daemon first (D7.1, D7.2), then its requests and wait. */
export async function commitQueue(
  input: QueueInput,
  commit: CommitDaemonInput,
): Promise<SideQueue> {
  if (input.files.length === 0) return NOTHING;
  // Review wave-23 B1: its place wait, install and claim end with the call's requests.
  const bound = input.askBy();
  const tree = await input.daemons.commit({ ...commit, deadline: bound });
  if (typeof tree !== "string") return unreached(input.files, tree.problem, Date.now() >= bound);
  return queueSide({ ...input, root: tree });
}

/** The working tree's side: its daemon, started when none runs, then its requests and wait. */
export async function worktreeQueue(input: QueueInput, root: AbsolutePath): Promise<SideQueue> {
  if (input.files.length === 0) return NOTHING;
  if (input.ask && input.started !== true) {
    // Review wave-23 B1: no daemon is started once the call's requests are over.
    if (Date.now() >= input.askBy())
      return unreached(
        input.files,
        "the call's wait ended before this worktree's daemon was asked (starting)",
        true,
      );
    // Row 023-40c: the start's own waits end by the call's bound too.
    const problem = await input.daemons.worktree(root, input.askBy());
    if (problem !== null) return unreached(input.files, problem);
  }
  return queueSide({ ...input, root });
}

/** One request per group to the daemon of `root`, then the wait over the files it took. */
export async function queueSide(
  input: QueueInput & { readonly root: AbsolutePath },
): Promise<SideQueue> {
  const { daemons, root, files, deadline, call } = input;
  const view = groupView(readPolicy(root));
  const groupOf = (ref: TestFileRef) => view.of(ref).name;
  const byGroup = new Map<string, TestFileRef[]>();
  for (const ref of files) {
    const group = groupOf(ref);
    byGroup.set(group, [...(byGroup.get(group) ?? []), ref]);
  }
  const pending = new Set<string>();
  const problems: string[] = [];
  const waited: TestFileRef[] = [];
  // Row 023-58 (W1): a group the wait's end left not asked is the call's to ask again (`--run`).
  let late = false;
  for (const [group, refs] of byGroup) {
    if (!input.ask) {
      waited.push(...refs);
      continue;
    }
    const paths = [...new Set(refs.map((ref) => ref.path))] as RelativePath[];
    const bound = input.askBy();
    if (Date.now() >= bound) {
      problems.push(`group ${group}: not asked: the call's wait ended`);
      late = true;
      continue;
    }
    const asked = await daemons
      .ask(root, group, paths, bound, call)
      .catch((error: unknown): { problem: string } => ({ problem: String(error) }));
    if (asked === "taken") waited.push(...refs);
    else if (asked === "pending") for (const ref of refs) pending.add(testFileId(ref));
    else problems.push(`group ${group}: ${asked.problem}`);
  }
  const lateness = late ? { late } : {};
  if (input.waits === false)
    return { root, files, pending, problems, groupOf, taken: waited, ...lateness };
  if (waited.length > 0) {
    const ended = await daemons
      .wait(root, waited, deadline)
      .catch((error: unknown) => String(error));
    if (ended !== null) problems.push(ended);
  }
  return { root, files, pending, problems, groupOf, ...lateness };
}

/**
 * Row 023-40c (R1 with the daemon's selection): the working tree's side in
 * two steps, one wait. First the files the call has at once (the change's
 * own test files and the named ones with no result now), then the files
 * `later` gives once the commit daemon selected them; then one wait over
 * every file taken, until none is pending or the deadline.
 */
export async function worktreeTwice(
  input: QueueInput,
  root: AbsolutePath,
  later: Promise<readonly TestFileRef[]>,
): Promise<SideQueue> {
  const first = await worktreeQueue({ ...input, waits: false }, root);
  const ids = new Set(input.files.map(testFileId));
  const extra = (await later).filter((ref) => !ids.has(testFileId(ref)));
  const second =
    extra.length === 0
      ? NOTHING
      : await worktreeQueue({ ...input, files: extra, waits: false }, root);
  const files = [...first.files, ...second.files];
  const reached = first.root ?? second.root;
  const problems = [...first.problems, ...second.problems];
  const late = first.late === true || second.late === true;
  if (reached === null)
    return files.length === 0 ? NOTHING : unreached(files, problems.join("; "), late);
  const pending = new Set([...first.pending, ...second.pending]);
  const taken = [...(first.taken ?? []), ...(second.taken ?? [])];
  if (taken.length > 0) {
    const ended = await input.daemons
      .wait(reached, taken, input.deadline)
      .catch((error: unknown) => String(error));
    if (ended !== null) problems.push(ended);
  }
  const view = groupView(readPolicy(reached));
  const groupOf = (ref: TestFileRef) => view.of(ref).name;
  return { root: reached, files, pending, problems, groupOf, ...(late ? { late } : {}) };
}
