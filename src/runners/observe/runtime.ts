import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AbsolutePath } from "../../core/types/index.js";
import { holdsRequire, quoteNodeOption } from "../process/node-options.js";
import { ownNodeOptions, UNOBSERVED } from "../process/recorders.js";

/**
 * Bumped when the recorder sees more or other paths, so a pass stored while
 * they went unobserved runs once more. It enters the adapter version of a
 * runner that observes (spec 001 D3; task 001-132; 001-135 made it 2, 001-139
 * 3 for recursive listings, 016-17 4 for `mkdtemp` creates and `written`).
 */
export const RECORDER_VERSION = "4";

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

/**
 * The env of a run that does not observe, under another Squeal's recorder
 * (spec 001 D11 Fidelity, task 001-431): `NODE_OPTIONS` without that
 * recorder, `""` when it was all there was (a Worker reads an unset value as
 * `"undefined"`), and that Squeal's settings replaced by `UNOBSERVED`, so its
 * spawn hook in this process leaves the run's processes as they are. `{}`
 * when `inherited` holds neither.
 */
export function unobservedEnv(inherited: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  const options = inherited.NODE_OPTIONS;
  const own = options === undefined ? undefined : ownNodeOptions(options);
  if (own !== options) env.NODE_OPTIONS = own ?? "";
  if (inherited[OBSERVE_VARIABLE] !== undefined) env[OBSERVE_VARIABLE] = UNOBSERVED;
  return env;
}
