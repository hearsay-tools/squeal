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
}

const NO_GROUP = () => "";

/** A side whose daemon was never reached: its files run nowhere, `problem` says why. */
export function unreached(files: readonly TestFileRef[], problem: string): SideQueue {
  return { root: null, files, pending: new Set(), problems: [problem], groupOf: NO_GROUP };
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
  readonly call: NarrowCall;
  /** `false` for `--wait` without `--run`: join, ask nothing. */
  readonly ask: boolean;
}

/** The commit side: its worktree and daemon first (D7.1, D7.2), then its requests and wait. */
export async function commitQueue(
  input: QueueInput,
  commit: CommitDaemonInput,
): Promise<SideQueue> {
  if (input.files.length === 0) return NOTHING;
  const tree = await input.daemons.commit(commit);
  if (typeof tree !== "string") return unreached(input.files, tree.problem);
  return queueSide({ ...input, root: tree });
}

/** The working tree's side: its daemon, started when none runs, then its requests and wait. */
export async function worktreeQueue(input: QueueInput, root: AbsolutePath): Promise<SideQueue> {
  if (input.files.length === 0) return NOTHING;
  if (input.ask) {
    const problem = await input.daemons.worktree(root);
    if (problem !== null)
      return unreached(input.files, `this worktree's daemon did not start: ${problem}`);
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
  for (const [group, refs] of byGroup) {
    if (!input.ask) {
      waited.push(...refs);
      continue;
    }
    const paths = [...new Set(refs.map((ref) => ref.path))] as RelativePath[];
    const asked = await daemons
      .ask(root, group, paths, deadline, call)
      .catch((error: unknown): { problem: string } => ({ problem: String(error) }));
    if (asked === "taken") waited.push(...refs);
    else if (asked === "pending") for (const ref of refs) pending.add(testFileId(ref));
    else problems.push(`group ${group}: ${asked.problem}`);
  }
  if (waited.length > 0) {
    const ended = await daemons
      .wait(root, waited, deadline)
      .catch((error: unknown) => String(error));
    if (ended !== null) problems.push(ended);
  }
  return { root, files, pending, problems, groupOf };
}
