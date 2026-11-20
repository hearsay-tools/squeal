import { withStores } from "../core/commit/at-keys-checkout.js";
import type { TestFileRef } from "../core/types/keys.js";
import { listLate, type NowInput, type NowSide, nowSide } from "./status-at-now.js";
import type { AtRun, NowPart } from "./status-at-run.js";
import { nowFiles, nowUse, runNow } from "./status-at-run-now.js";
import type { Selection } from "./status-at-run-select.js";

/*
 * Row 023-29 (lessons round 4, R1; spec 023 D4.10): `--run` answers both
 * sides in one call. Before the commit side runs, it learns how many files
 * the working tree's side will run (`nowCount`), so each side gets a share
 * of the one budget by its count. After it, the working tree's files run
 * (`runNow`), and the current side is read again, so the report shows
 * their results as ordinary worktree results.
 */

/** Whether a daemon serves the worktree, as the current side was read. */
export const servedByDaemon = (now: NowSide) =>
  now.source.kind === "daemon" || (now.source.kind === "stored" && now.source.why === "listing");

/** R1: the count of the working tree's files to run, given the commit side's selection. */
export function nowCount(now: NowSide): (selection: Selection) => number {
  return (selection) =>
    selection.selects === undefined ? 0 : nowFiles(now.refs, now.state, selection.selects).length;
}

export interface FillInput {
  readonly ran: AtRun;
  /** The report's files, both sides. */
  readonly refs: readonly TestFileRef[];
  /** The current side as read before the run. */
  readonly current: NowSide;
  /** What reads the current side again. */
  readonly read: Omit<NowInput, "main">;
  readonly relaunch: readonly string[] | undefined;
  readonly forward: (text: string) => void;
  readonly batchFiles?: number;
}

/**
 * R1: the working tree's files the change selects that have no result now
 * run there; then the current side read again. `null` when the commit side
 * made no selection (its checkout gave no keys): nothing to compare.
 */
export async function fillNow(
  input: FillInput,
): Promise<{ readonly current: NowSide; readonly part: NowPart } | null> {
  const selects = input.ran.selects();
  if (selects === null) return null;
  const { current, read } = input;
  const files = nowFiles(input.refs, current.state, selects);
  const end = await runNow({
    root: read.root,
    commonDir: read.commonDir,
    files,
    daemon: servedByDaemon(current),
    endMs: input.ran.endMs,
    timeoutSeconds: input.ran.timeoutSeconds,
    env: read.env,
    relaunch: input.relaunch,
    forward: input.forward,
    ...(input.batchFiles === undefined ? {} : { batchFiles: input.batchFiles }),
  });
  const again =
    files.length === 0
      ? current
      : await listLate(
          read,
          await withStores(read.commonDir, (main) => nowSide({ ...read, main })),
          input.refs,
        );
  const use = nowUse({ files }, end, again.state);
  const left = use.how === "gate" ? use.notRun : 0;
  const fit = { left, ran: use.ran, gateMs: end.gateMs, estimate: end.leftEstimate };
  return { current: again, part: { use, fit } };
}
