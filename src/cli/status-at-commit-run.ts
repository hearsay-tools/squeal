import type { CheckoutHooks } from "../core/commit/at-keys-checkout.js";
import type { CheckoutOptions } from "../core/commit/at-keys-walk.js";
import { squealVersion } from "../core/daemon/version.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { AtOptions } from "./status-at.js";
import { type CommitSide, commitSide } from "./status-at-commit.js";
import { nextProbe } from "./status-at-next.js";
import type { SideState } from "./status-at-report.js";
import { type AtRun, atRun, type NowTurn, type RunArgs } from "./status-at-run.js";

/*
 * Spec 023 D2, D4 (rows 023-06, 023-07, 023-24; row 023-29 moved it out
 * of `statusAtCommand`): the commit side of one call. The keying in the
 * temporary checkout at the commit and, with `--run`, the run in it
 * (`atRun`), which starts the one budget here: its `endMs` is the call's
 * deadline, which the working tree's side reads too. Without `--run`,
 * Q1's probe of what `--run` would run. `now`, the working tree's turn
 * (R1), runs inside the commit side's run; without it only the commit
 * side runs, which tests of the commit side's run ask for.
 */

/** The checkout's own install budget (row 023-16), when `--run`'s is longer. */
const INSTALL_TIMEOUT_MS = 300_000;

export interface CommitRunInput {
  /** The user's worktree, its git common dir and its id. */
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The commit, resolved, and as the user gave it with the paths (the rerun's words). */
  readonly commit: string;
  readonly given: string;
  readonly givenPaths: readonly string[];
  /** The paths relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  /** `--run`'s words; `null` without `--run`. */
  readonly run: RunArgs | null;
  /** The command's environment as it started: the keying's and the run's. */
  readonly env: NodeJS.ProcessEnv;
  readonly relaunch: readonly string[] | undefined;
  /** One stderr line. */
  readonly note: (text: string) => void;
  /** The run's own output, as it comes. */
  readonly forward: (text: string) => void;
  readonly options: AtOptions;
  /** R1: the working tree's turn; absent, the commit side runs alone. */
  readonly now?: NowTurn;
}

export interface CommitRun {
  readonly at: CommitSide;
  /** `--run`'s run, the owner of the call's deadline; `null` without `--run`. */
  readonly ran: AtRun | null;
  /** Q1's probe; `null` with `--run`. */
  readonly probe: ReturnType<typeof nextProbe> | null;
  /** Each file's commit side: what the run gave it, else the keying's (R8 marks it). */
  readonly state: (ref: TestFileRef) => SideState;
}

/** The commit side: its keying, and its run with `--run`, the working tree's turn inside. */
export async function commitRun(input: CommitRunInput): Promise<CommitRun> {
  const { root, commit, run } = input;
  const { batchFiles, ...checkoutOptions } = input.options;
  const ran =
    run === null
      ? null
      : atRun({
          args: run,
          root,
          commonDir: input.commonDir,
          own: input.worktreeId,
          commit,
          given: input.given,
          paths: input.givenPaths,
          ...(input.paths === null ? {} : { named: input.paths }),
          env: input.env,
          relaunch: input.relaunch,
          started: performance.now(),
          note: input.note,
          forward: input.forward,
          ...(batchFiles === undefined ? {} : { batchFiles }),
          ...(input.now === undefined ? {} : { now: input.now }),
        });
  const probe =
    ran === null
      ? nextProbe({
          root,
          commit,
          given: input.given,
          paths: input.givenPaths,
          ...(input.paths === null ? {} : { named: input.paths }),
        })
      : null;
  // Row 023-35 (T2): each node:test project's files with an incomplete static closure.
  const lists = new Map<string, ReadonlySet<RelativePath>>();
  const adapters: typeof daemonAdapters = (root, policy, tempDir) =>
    daemonAdapters(root, policy, tempDir, (project, files) =>
      lists.set(project, new Set(files.map(([path]) => path))),
    );
  const keying = { adapters, squealVersion: squealVersion(), env: input.env };
  const at = await commitSide({
    ...keying,
    ...checkoutOptions,
    root,
    commit,
    paths: input.paths,
    worktreeId: input.worktreeId,
    note: input.note,
    ...hooksOf(ran, probe, run),
  });
  const state =
    ran === null
      ? at.state
      : (ref: TestFileRef) => closureOf(lists, ref, ran.state(ref, at.state(ref)));
  return { at, ran, probe, state };
}

/**
 * Row 023-35 (T2): a file the change did not select, with what its runner
 * told of its static closure: `unchecked` when it told nothing (Vitest, or
 * a project whose list never came), so the report never vouches for it.
 */
function closureOf(
  lists: ReadonlyMap<string, ReadonlySet<RelativePath>>,
  ref: TestFileRef,
  side: SideState,
): SideState {
  if (side.state !== "no result" || side.notSelected !== true) return side;
  const list = lists.get(ref.project);
  const closure = list === undefined ? "unchecked" : list.has(ref.path) ? "incomplete" : "complete";
  return { ...side, closure };
}

/** The checkout's hooks: `--run`'s, with its install inside the one budget (D4.6), or Q1's probe. */
function hooksOf(
  ran: AtRun | null,
  probe: ReturnType<typeof nextProbe> | null,
  run: RunArgs | null,
): Pick<CheckoutOptions, "installTimeoutMs"> & CheckoutHooks {
  if (ran === null) return probe === null ? {} : { whileOpen: probe.whileOpen };
  return {
    whileOpen: ran.whileOpen,
    beforeRemove: ran.beforeRemove,
    installTimeoutMs: Math.min(INSTALL_TIMEOUT_MS, (run?.timeoutSeconds ?? 0) * 1000),
  };
}
