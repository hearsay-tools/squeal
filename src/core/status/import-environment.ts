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

/** One line per comparison, as `squeal import` prints it; a named project is named. */
export function comparisonText(project: ProjectName, comparison: EnvironmentComparison): string {
  const name = project === "" ? "Environment" : `Environment of project ${JSON.stringify(project)}`;
  switch (comparison.kind) {
    case "equal":
      return `${name}: equal to this worktree's`;
    case "unknown":
      return `${name}: none recorded for this worktree yet; squeal status --full compares them once its daemon keyed the files`;
    case "differs":
      return comparison.differences.length === 0
        ? `${name}: differs from this worktree's; one side holds no record of its parts`
        : `${name}: differs from this worktree's: ${comparison.differences.join("; ")}`;
  }
}
