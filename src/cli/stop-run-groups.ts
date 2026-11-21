import { realpathSync } from "node:fs";
import { readGroups, runGroupsFile, stopGroups, writeGroups } from "../core/daemon/run-groups.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath } from "../core/types/common.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3): once no daemon serves the worktree,
 * `squeal stop` ends every process group a `--run` run started that is
 * still alive, by the daemon's record of each group's id and leader start
 * (`run-groups.ts`), never by a path or a command line. A daemon stops them
 * itself at a run's end and at its exit; what is left here is a daemon
 * killed mid-run's.
 */

/**
 * Ends what the record of `root` lists and clears it; the line naming what
 * it ended, or `null` for nothing. Never throws.
 */
export async function endRunGroups(root: AbsolutePath): Promise<string | null> {
  try {
    const real = realpathSync(root) as AbsolutePath;
    const commonDir = resolveCommonDir(real);
    if (commonDir === null) return null;
    const file = runGroupsFile(realpathSync(commonDir) as AbsolutePath, real);
    const groups = readGroups(file);
    if (groups.length === 0) return null;
    const stopped = await stopGroups(groups);
    writeGroups(file, []);
    if (stopped.length === 0) return null;
    const named = stopped.map(({ pid, args, run }) =>
      `${pid} ${args}`.trimEnd().concat(run === undefined ? "" : ` (${run})`),
    );
    const count = stopped.length === 1 ? "1 process" : `${stopped.length} processes`;
    return `Ended ${count} in a process group a \`--run\` run started: ${named.join("; ")}\n`;
  } catch {
    return null;
  }
}
