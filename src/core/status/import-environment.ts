import { describeDifferences } from "../keys/environment-descriptor.js";
import type { StoredEnvironment } from "../store/environments.js";
import type { ExportedEnvironment } from "../store/transfer-bundle.js";
import type { ProjectName } from "../types/common.js";

/**
 * Spec 018 D3 and D5: how one project's environment in an export compares
 * with the one this worktree keys it with now (D1). `unknown` before this
 * worktree's daemon recorded one; `differs` names each part when both sides
 * hold a descriptor.
 */
export type EnvironmentComparison =
  | { readonly kind: "equal" }
  | { readonly kind: "unknown" }
  | { readonly kind: "differs"; readonly differences: readonly string[] };

export function compareEnvironment(
  exported: Pick<ExportedEnvironment, "hash" | "descriptor">,
  local: StoredEnvironment | null,
): EnvironmentComparison {
  if (local === null) return { kind: "unknown" };
  if (local.hash === exported.hash) return { kind: "equal" };
  const differences =
    exported.descriptor === null || local.descriptor === null
      ? []
      : describeDifferences(exported.descriptor, local.descriptor).map((d) => d.text);
  return { kind: "differs", differences };
}

/** `project "<name>"`, or `the project` for the unnamed one. */
export function projectName(project: ProjectName): string {
  return project === "" ? "the project" : `project ${JSON.stringify(project)}`;
}

/** One line per comparison, as `squeal import` prints it. */
export function comparisonText(project: ProjectName, comparison: EnvironmentComparison): string {
  const name = projectName(project);
  switch (comparison.kind) {
    case "equal":
      return `${name}: the export's environment equals this worktree's`;
    case "unknown":
      return `${name}: this worktree has no environment recorded yet; squeal status --full compares them once its daemon keyed the files`;
    case "differs":
      return comparison.differences.length === 0
        ? `${name}: the export's environment differs from this worktree's; one side holds no record of its parts`
        : `${name}: the environment differs: ${comparison.differences.join("; ")}`;
  }
}
