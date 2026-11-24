import { describeDifferences } from "../../keys/environment-descriptor.js";
import { environmentRecord } from "../../keys/environment-hash.js";
import { compareEnvironment } from "../../status/import-environment.js";
import type { EpochMs } from "../../types/common.js";
import type { CoreEnvironmentInputs, FileHash } from "../../types/keys.js";
import type { RunnerEnvironment } from "../../types/runner.js";
import { type EnvironmentMode, nodeRefusal, onMachine } from "./remote-key.js";

/*
 * Spec 021 D11.2 (row 021-14): a remote result is stored only when the
 * remote's environment equals this worktree's: `compareEnvironment` (spec
 * 018 D1) of each project's record answers `equal`. 018's `passes`
 * tolerance for CI does not apply. Without it a remote on another Node
 * patch version passed under the local key (`runner-split.md` Q6).
 *
 * D12 runs the remote with coverage off, so each side's resolved config is
 * compared with its `coverage` field taken out (row 021-22): with coverage
 * on here, the default, every remote run was refused (`boat-trial.md` D1).
 * Only that field: any other part that differs still refuses.
 *
 * Spec 026 D10 (row 026-14): under `environmentMode: "remote-key"` the
 * remote's platform and arch may differ, and its Node too when it meets the
 * project's Node pins; the results are keyed under the remote's machine. Its
 * projects, config files, resolved config, installed dependencies and
 * allow-listed variables still equal this side's.
 */

/** One side's environment: its process's inputs, its runner's per project, and its config files' blob ids. */
export interface EnvironmentSide {
  readonly core: CoreEnvironmentInputs;
  readonly runners: readonly RunnerEnvironment[];
  readonly blob: (path: string) => string | null;
}

/** How `environmentDifferences` compares: its mode, default `match-local`, and the project's Node pins. */
export interface DifferenceOptions {
  readonly mode?: EnvironmentMode;
  /** `.node-version` or `.nvmrc` values and `engines.node`, which a remote's Node meets under `remote-key`. */
  readonly nodePins?: readonly string[];
}

/** What differs, one text each, such as `Node v24.21.0 on the remote, v24.22.1 here`; `[]`: equal. */
export function environmentDifferences(
  given: EnvironmentSide,
  local: EnvironmentSide,
  options: DifferenceOptions = {},
): string[] {
  const texts: string[] = [];
  let remote = given;
  if (options.mode === "remote-key") {
    // D10.2: the machine may differ; what is left compares as under `match-local`.
    const node = nodeRefusal(
      given.core.nodeVersion,
      local.core.nodeVersion,
      options.nodePins ?? [],
    );
    if (node !== null) texts.push(node);
    remote = { ...given, core: onMachine(given.core, local.core) };
  }
  const remoteOf = new Map(remote.runners.map((runner) => [runner.project, runner]));
  for (const here of local.runners) {
    const there = remoteOf.get(here.project);
    remoteOf.delete(here.project);
    if (there === undefined) {
      texts.push(`project ${JSON.stringify(here.project)} is not on the remote`);
      continue;
    }
    const a = environmentRecord(
      remote.core,
      withoutCoverage(there),
      (p) => remote.blob(p) as FileHash | null,
      false,
    );
    const b = environmentRecord(
      local.core,
      withoutCoverage(here),
      (p) => local.blob(p) as FileHash | null,
      false,
    );
    const stored = { project: here.project, ...b, recordedAt: 0 as EpochMs };
    if (compareEnvironment(a, stored).kind === "equal") continue;
    const found = describeDifferences(a.descriptor, b.descriptor).map((d) =>
      d.text
        .replace(" in the export, ", " on the remote, ")
        .replace("in the export", "on the remote"),
    );
    texts.push(...(found.length > 0 ? found : ["the environment differs"]));
  }
  for (const project of remoteOf.keys()) {
    texts.push(`project ${JSON.stringify(project)} is only on the remote`);
  }
  return [...new Set(texts)];
}

/** Spec 021 D12: `runner` with its resolved config's `coverage` field taken out, when it is a JSON object with one. */
function withoutCoverage(runner: RunnerEnvironment): RunnerEnvironment {
  let config: unknown;
  try {
    config = JSON.parse(runner.resolvedConfig);
  } catch {
    return runner;
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) return runner;
  if (!Object.hasOwn(config, "coverage")) return runner;
  const { coverage: _off, ...rest } = config as Record<string, unknown>;
  return { ...runner, resolvedConfig: JSON.stringify(rest) };
}
