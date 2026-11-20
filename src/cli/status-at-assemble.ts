import { readHead } from "../core/daemon-loop/head.js";
import { runGit } from "../core/fs/git.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { CommitRun } from "./status-at-commit-run.js";
import { nextOf } from "./status-at-next.js";
import type { NowSide } from "./status-at-now.js";
import { type AtReport, compareSides } from "./status-at-report.js";
import type { NowPart } from "./status-at-run.js";

/*
 * Spec 023 D1, D3 (rows 023-06, 023-07, 023-24; row 023-29 moved it out
 * of `statusAtCommand`): the report of one call, from both sides once
 * every run ended: each file compared, the commit's and HEAD's facts, the
 * checkout's, `--run`'s budget use with the working tree's part, and Q1's
 * next step.
 */

export interface AssembleInput {
  readonly root: AbsolutePath;
  readonly commit: string;
  /** Both sides' files, and the named paths that select none. */
  readonly refs: readonly TestFileRef[];
  readonly unmatched: readonly RelativePath[];
  /** The current side as last read: after the working tree's run, when it ran. */
  readonly current: NowSide;
  readonly side: CommitRun;
  /** R1: the working tree's part of `--run`; `null` when it did not run. */
  readonly part: NowPart | null;
}

export async function assembleReport(input: AssembleInput): Promise<AtReport> {
  const { root, commit, side, current, unmatched } = input;
  const { at, ran } = side;
  const head = await readHead(root);
  return {
    commit,
    commitTimeMs: await commitTime(root, commit),
    head: head.head,
    dirty: head.dirty,
    now: current.source,
    checkoutMs: at.checkoutMs,
    inputCheckMs: at.inputCheckMs,
    changed: at.changed,
    failure: at.failure,
    files: compareSides(input.refs, side.state, current.state),
    ...(unmatched.length === 0 ? {} : { unmatched }),
    ...(ran === null ? {} : { run: ran.use(input.part ?? undefined) }),
    ...nextOf(side.probe, at),
  };
}

async function commitTime(root: AbsolutePath, commit: string): Promise<number> {
  const out = await runGit(root, ["show", "-s", "--format=%ct", commit]);
  return Number(out.trim()) * 1000;
}
