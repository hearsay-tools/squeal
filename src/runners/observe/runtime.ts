import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AbsolutePath } from "../../core/types/index.js";
import { ownNodeOptions } from "../node-test/recorders.js";
import { holdsRequire, quoteNodeOption } from "../node-test/run/node-options.js";

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
 * How `NODE_OPTIONS` loads the recorder (spec 001 D11 Fidelity, task
 * 001-390): `--import` of its `file:` URL, since every `--require` preload
 * makes Node parse the nearest `package.json` above the cwd first, and one
 * that is not JSON then stops a child Node that would start without Squeal
 * (research injected-environment F1). Beside a project's own `--require`, a
 * `--require`: Node runs every one before any `--import`, so the recorder
 * still sees what that preload reads, and plain Node parses the file then
 * too. `spawn.cjs` applies the same rule at each spawn.
 */
export function recorderOption(recorder: AbsolutePath, inherited: string | undefined): string {
  return inherited !== undefined && holdsRequire(inherited)
    ? `--require ${quoteNodeOption(recorder)}`
    : `--import ${quoteNodeOption(pathToFileURL(recorder).href)}`;
}

/**
 * The env that loads the recorder into a process: `recorderOption` first in
 * `NODE_OPTIONS`, ahead of what `inherited` held. Another Squeal's recorder
 * there, under a Squeal that runs these tests, is left out: it is no project
 * preload, and these settings would be its own, so it recorded nothing of its
 * own run.
 */
export function observeEnv(
  recorder: AbsolutePath,
  settings: ObserveSettings,
  inherited: string | undefined,
): Record<string, string> {
  const options = (inherited === undefined ? undefined : ownNodeOptions(inherited))?.trim() ?? "";
  const option = recorderOption(recorder, options);
  return {
    NODE_OPTIONS: options === "" ? option : `${option} ${options}`,
    [OBSERVE_VARIABLE]: JSON.stringify(settings),
  };
}
