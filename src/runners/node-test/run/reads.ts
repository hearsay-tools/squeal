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
  recorderOption,
  takeRecorded,
} from "../../observe/index.js";

/**
 * A warm-up's reads (task 001-307): 001-132's recorder in every process of
 * the run, so what each file read reaches `RunReport.reads`, ignored paths
 * too. It goes first in `NODE_OPTIONS` as `recorderOption` writes it (task
 * 001-390): an `--import`, which Node runs after argv's `--require` of this
 * runner's module recorder, or beside a project `--require` a `--require`,
 * which Node runs before it. Either way its own modules load by an absolute
 * path or `file:` URL from no module, which `observedClosure` roots in the
 * preloads, and lie outside the worktree, so a closure or a key is as
 * without it. The recorder carries itself into every child, ahead of what
 * the child's `NODE_OPTIONS` held, the module recorder included. Only module
 * loads key a node:test file; these reads key nothing.
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
    const options = env.NODE_OPTIONS?.trim() ?? "";
    const option = recorderOption(this.recorder, options);
    // The temp directory is skipped when it lies inside the worktree, never when the worktree lies in it.
    const temp = tmpdir();
    const skip = `${this.root}${sep}`.startsWith(`${temp}${sep}`) ? [] : [temp];
    const settings = { out: this.out, root: this.root, skip, file: absolute };
    return {
      ...env,
      NODE_OPTIONS: options === "" ? option : `${option} ${options}`,
      [OBSERVE_VARIABLE]: JSON.stringify(settings),
    };
  }

  /** What each of `completed` read, none for one that read none; the recorder's files are read and removed. */
  take(completed: readonly TestFileRef[], paths: WorktreePaths): ObservedInputs[] {
    return readsOfEvery(observedInputs(takeRecorded(this.out), completed, paths), completed);
  }
}
