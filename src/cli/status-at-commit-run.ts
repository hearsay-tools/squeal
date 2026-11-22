import { squealVersion } from "../core/daemon/version.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { AtOptions } from "./status-at.js";
import { type CommitSide, commitSide } from "./status-at-commit.js";
import { nextProbe } from "./status-at-next.js";
import type { SideState } from "./status-at-report.js";

/*
 * Spec 023 D2 (rows 023-06, 023-24; row 023-29 moved it out of
 * `statusAtCommand`): the commit side of plain `status --at`: the keying
 * in a temporary checkout at the commit, with Q1's probe of what `--run`
 * would queue. Row 023-41 removed the in-call run that also lived here;
 * `--run` and `--wait` ask the daemons (`status-at-call.ts`).
 */

export interface CommitRunInput {
  /** The user's worktree and its id. */
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The commit, resolved, and as the user gave it with the paths (the rerun's words). */
  readonly commit: string;
  readonly given: string;
  readonly givenPaths: readonly string[];
  /** The paths relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  /** The command's environment as it started: the keying's. */
  readonly env: NodeJS.ProcessEnv;
  /** One stderr line. */
  readonly note: (text: string) => void;
  readonly options: AtOptions;
}

export interface CommitRun {
  readonly at: CommitSide;
  /** Q1's probe; `null` when the report's own lines say what is next. */
  readonly probe: ReturnType<typeof nextProbe> | null;
  /** Each file's commit side, from the keying. */
  readonly state: (ref: TestFileRef) => SideState;
}

/** The commit side: its keying, with Q1's probe. */
export async function commitRun(input: CommitRunInput): Promise<CommitRun> {
  const { root, commit } = input;
  const probe = nextProbe({
    root,
    commit,
    given: input.given,
    paths: input.givenPaths,
    ...(input.paths === null ? {} : { named: input.paths }),
  });
  const at = await commitSide({
    adapters: daemonAdapters,
    squealVersion: squealVersion(),
    env: input.env,
    ...input.options,
    root,
    commit,
    paths: input.paths,
    worktreeId: input.worktreeId,
    note: input.note,
    whileOpen: probe.whileOpen,
  });
  return { at, probe, state: at.state };
}
