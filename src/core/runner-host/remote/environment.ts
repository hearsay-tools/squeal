import { describeDifferences } from "../../keys/environment-descriptor.js";
import { environmentRecord } from "../../keys/environment-hash.js";
import { compareEnvironment } from "../../status/import-environment.js";
import type { EpochMs } from "../../types/common.js";
import type { CoreEnvironmentInputs, FileHash } from "../../types/keys.js";
import type { RunnerEnvironment } from "../../types/runner.js";

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
 */

/** One side's environment: its process's inputs, its runner's per project, and its config files' blob ids. */
export interface EnvironmentSide {
  readonly core: CoreEnvironmentInputs;
  readonly runners: readonly RunnerEnvironment[];
  readonly blob: (path: string) => string | null;
}

/** What differs, one text each, such as `Node v24.21.0 on the remote, v24.22.1 here`; `[]`: equal. */
export function environmentDifferences(remote: EnvironmentSide, local: EnvironmentSide): string[] {
  const texts: string[] = [];
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
