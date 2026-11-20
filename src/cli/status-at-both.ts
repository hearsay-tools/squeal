import { withStores } from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { TestFileRef } from "../core/types/keys.js";
import { listLate, type NowInput, type NowSide, nowSide } from "./status-at-now.js";
import type { AtRun, NowPart, NowTurn } from "./status-at-run.js";
import { type NowRunEnd, nowFiles, nowUse, runNow } from "./status-at-run-now.js";

/*
 * Row 023-29 (lessons round 4, R1; spec 023 D4.10): `--run` answers both
 * sides in one call. The working tree's side takes its turn inside the
 * commit side's run, while the checkout is open (`NowTurn`): the commit
 * side runs first, in a share of the budget by its count; then the working
 * tree's files, in a share of what is left beside the commit side's
 * leftovers; then those leftovers until the budget ends. After the
 * checkout is removed, the working tree's own leftovers (and files only a
 * listing daemon's late list adds) take what is still left. So time either
 * side leaves unused goes to the other, and the whole call ends inside the
 * one `--timeout`. Then the current side is read again, so the report
 * shows their results as ordinary worktree results.
 */

/** Whether a daemon serves the worktree, as the current side was read. */
export const servedByDaemon = (now: NowSide) =>
  now.source.kind === "daemon" || (now.source.kind === "stored" && now.source.why === "listing");

/** Below this many ms left, the last pass does not start: it could run nothing. */
const LAST_PASS_MS = 5_000;

export interface TurnInput {
  /** The current side as read before the run. */
  readonly now: NowSide;
  /** What reads the current side again. */
  readonly read: Omit<NowInput, "main">;
  /** The one budget, in seconds: it sizes a batch's aim. */
  readonly timeoutSeconds: number;
  readonly relaunch: readonly string[] | undefined;
  readonly forward: (text: string) => void;
  readonly batchFiles?: number;
}

/** R1: the working tree's side, as the commit side's turn and the report's last pass. */
export interface WorkingTree extends NowTurn {
  /**
   * After the checkout is removed: the last pass over what is left, then
   * the current side read again. `null` when the commit side made no
   * selection (its checkout gave no keys): nothing to compare.
   */
  finish(
    ran: AtRun,
    refs: readonly TestFileRef[],
    current: NowSide,
  ): Promise<{ readonly current: NowSide; readonly part: NowPart } | null>;
}

export function workingTree(input: TurnInput): WorkingTree {
  const { read } = input;
  let files: TestFileRef[] = [];
  let end: NowRunEnd | null = null;
  const { timeoutSeconds } = input;
  const pass = async (list: readonly TestFileRef[], endMs: number, current: NowSide) => {
    const next = await runNow({
      root: read.root,
      commonDir: read.commonDir,
      files: list,
      daemon: servedByDaemon(current),
      endMs,
      timeoutSeconds,
      env: read.env,
      relaunch: input.relaunch,
      forward: input.forward,
      ...(input.batchFiles === undefined ? {} : { batchFiles: input.batchFiles }),
    });
    end = merged(end, next, list);
  };
  return {
    files(selection) {
      files =
        selection.selects === undefined
          ? []
          : nowFiles(input.now.refs, input.now.state, selection.selects);
      return files.length;
    },
    run: (endMs) => pass(files, endMs, input.now),
    async finish(ran, refs, current) {
      const selects = ran.selects();
      if (selects === null) return null;
      const ids = new Set(files.map(testFileId));
      // A listing daemon's late files, which the turn's list could not hold, and the leftovers.
      const late = nowFiles(refs, current.state, selects).filter(
        (ref) => !ids.has(testFileId(ref)),
      );
      const left = [...files.filter((ref) => budgetLeft(end, ref)), ...late];
      files = [...files, ...late];
      if (left.length > 0 && ran.endMs - performance.now() > LAST_PASS_MS)
        await pass(left, ran.endMs, current);
      const again =
        end === null
          ? current
          : await listLate(
              read,
              await withStores(read.commonDir, (main) => nowSide({ ...read, main })),
              refs,
            );
      const last: NowRunEnd = end ?? {
        how: servedByDaemon(current) ? "daemon" : "gate",
        gateMs: null,
        states: new Map(),
        problem: null,
        leftEstimate: null,
      };
      const use = nowUse({ files }, last, again.state);
      const leftCount = use.how === "gate" ? use.notRun : 0;
      const fit = {
        left: leftCount,
        ran: use.ran,
        gateMs: last.gateMs,
        estimate: last.leftEstimate,
      };
      return { current: again, part: { use, fit } };
    },
  };
}

/** Whether the run so far left `ref` for want of budget. */
function budgetLeft(end: NowRunEnd | null, ref: TestFileRef): boolean {
  const state = end?.states.get(testFileId(ref));
  return state?.state === "not run" && state.reason === "budget";
}

/** Two passes as one: the later pass's files take its states, the times add up. */
function merged(
  earlier: NowRunEnd | null,
  later: NowRunEnd,
  list: readonly TestFileRef[],
): NowRunEnd {
  if (earlier === null) return later;
  const again = new Set(list.map(testFileId));
  const states = new Map([...earlier.states].filter(([id]) => !again.has(id)));
  for (const [id, state] of later.states) states.set(id, state);
  const times = [earlier.gateMs, later.gateMs].filter((ms): ms is number => ms !== null);
  return {
    how: later.how,
    gateMs: times.length === 0 ? null : times.reduce((a, b) => a + b, 0),
    states,
    problem: earlier.problem ?? later.problem,
    leftEstimate: later.leftEstimate,
  };
}
