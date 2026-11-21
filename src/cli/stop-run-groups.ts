import { realpathSync } from "node:fs";
import { readRuns, runGroupsFile, writeRuns } from "../core/daemon/run-groups.js";
import { sparedText, stopRuns } from "../core/daemon/run-groups-stop.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath } from "../core/types/common.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3): once no daemon serves the worktree,
 * `squeal stop` ends what the `--run` runs its record lists started and is
 * still running: what carries a run's token, and the groups live carriers
 * lead (`run-groups-stop.ts`), never a path or a command line. A daemon
 * stops them itself at a run's end and at its exit; what is left here is a
 * daemon killed mid-run's, or what a run's stop spared, named again.
 */

/**
 * Ends what the record of `root` lists and clears it; the lines naming what
 * it ended and what it left, or `null` for nothing. Never throws.
 */
export async function endRunGroups(root: AbsolutePath): Promise<string | null> {
  try {
    const real = realpathSync(root) as AbsolutePath;
    const commonDir = resolveCommonDir(real);
    if (commonDir === null) return null;
    const file = runGroupsFile(realpathSync(commonDir) as AbsolutePath, real);
    const runs = readRuns(file);
    if (runs.length === 0) return null;
    const { stopped, spared } = await stopRuns(runs);
    writeRuns(file, []);
    const lines: string[] = [];
    if (stopped.length > 0) {
      const named = stopped.map(({ pid, args, run }) =>
        `${pid} ${args}`.trimEnd().concat(run === undefined ? "" : ` (${run})`),
      );
      const count = stopped.length === 1 ? "1 process" : `${stopped.length} processes`;
      lines.push(`Ended ${count} a \`--run\` run started: ${named.join("; ")}\n`);
    }
    const left = sparedText(spared);
    if (left !== null) lines.push(`${left[0]?.toUpperCase()}${left.slice(1)}\n`);
    return lines.length === 0 ? null : lines.join("");
  } catch {
    return null;
  }
}
