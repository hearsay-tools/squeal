import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AbsolutePath } from "../../core/types/index.js";

/**
 * Bumped when the recorder sees more or other paths, so a pass stored while
 * they went unobserved runs once more. It enters the adapter version of a
 * runner that observes (spec 001 D3; task 001-132; 001-135 made it 2, 001-139
 * 3 for recursive listings).
 */
export const RECORDER_VERSION = "3";

/** The env variable carrying the recorder's settings (`recorder.cjs`). */
export const OBSERVE_VARIABLE = "SQUEAL_OBSERVE";

/** What the recorder needs in a process (`recorder.cjs`). */
export interface ObserveSettings {
  /** Where each process appends its observations. */
  readonly out: AbsolutePath;
  /** The worktree; nothing outside it is recorded. */
  readonly root: AbsolutePath;
  /** Absolute prefixes never recorded: the run's own temp directories. */
  readonly skip: readonly AbsolutePath[];
}

/**
 * Where the recorder sits relative to `module`, the running code's own file:
 * from a bundled CLI at `<plugin>/dist/cli/`, the plugin's `dist/observe/`;
 * from the TypeScript sources, beside this file. `null` when neither holds it.
 */
const CANDIDATES = ["../observe/", "./observe/", "./"] as const;

export function observeRecorder(module: URL = new URL(import.meta.url)): AbsolutePath | null {
  for (const candidate of CANDIDATES) {
    const recorder = fileURLToPath(new URL(`${candidate}recorder.cjs`, module));
    if (existsSync(recorder)) return recorder;
  }
  return null;
}

/**
 * The env that loads the recorder into a process: `--require <recorder>`
 * first in `NODE_OPTIONS`, ahead of what `inherited` held, and the settings.
 */
export function observeEnv(
  recorder: AbsolutePath,
  settings: ObserveSettings,
  inherited: string | undefined,
): Record<string, string> {
  const require = `--require ${JSON.stringify(recorder)}`;
  const options = inherited?.trim() ?? "";
  return {
    NODE_OPTIONS: options === "" ? require : `${require} ${options}`,
    [OBSERVE_VARIABLE]: JSON.stringify(settings),
  };
}
