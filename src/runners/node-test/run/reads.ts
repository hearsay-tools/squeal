import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { AbsolutePath, ObservedInputs, TestFileRef } from "../../../core/types/index.js";
import {
  OBSERVE_VARIABLE,
  observedInputs,
  observeRecorder,
  readsOfEvery,
  takeRecorded,
} from "../../observe/index.js";
import { quoteNodeOption } from "./node-options.js";

/**
 * A warm-up's reads (task 001-307): 001-132's recorder in every process of
 * the run, so what each file read reaches `RunReport.reads`, ignored paths
 * too. It goes first in `NODE_OPTIONS`, which Node runs before argv's
 * `--require`, so it loads before this runner's module recorder registers
 * its hooks: its own modules and its absolute `--require` are no edge of the
 * graph, and a closure, a preload phase or a key is as without it. The
 * recorder carries itself into every child, ahead of what the child's
 * `NODE_OPTIONS` held, the module recorder included. Only module loads key
 * a node:test file; these reads key nothing.
 */
export class NodeTestReads {
  private constructor(
    private readonly recorder: AbsolutePath,
    private readonly out: AbsolutePath,
    private readonly root: AbsolutePath,
  ) {}

  /** `null` when the recorder is not there (a `tsc`-only build); the run then reports no reads. */
  static start(root: AbsolutePath, logDir: AbsolutePath): NodeTestReads | null {
    const recorder = observeRecorder();
    if (recorder === null) return null;
    const out = join(logDir, "reads");
    mkdirSync(out, { recursive: true });
    return new NodeTestReads(recorder, out, root);
  }

  /** The env of `absolute`'s process: the recorder first, its settings naming the file. */
  env(env: NodeJS.ProcessEnv, absolute: AbsolutePath): NodeJS.ProcessEnv {
    const require = `--require ${quoteNodeOption(this.recorder)}`;
    const options = env.NODE_OPTIONS?.trim() ?? "";
    // The temp directory is skipped when it lies inside the worktree, never when the worktree lies in it.
    const temp = tmpdir();
    const skip = `${this.root}${sep}`.startsWith(`${temp}${sep}`) ? [] : [temp];
    const settings = { out: this.out, root: this.root, skip, file: absolute };
    return {
      ...env,
      NODE_OPTIONS: options === "" ? require : `${require} ${options}`,
      [OBSERVE_VARIABLE]: JSON.stringify(settings),
    };
  }

  /** What each of `completed` read, none for one that read none; the recorder's files are read and removed. */
  take(completed: readonly TestFileRef[], paths: WorktreePaths): ObservedInputs[] {
    return readsOfEvery(observedInputs(takeRecorded(this.out), completed, paths), completed);
  }
}
