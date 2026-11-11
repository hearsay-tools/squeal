import {
  describeDifferences,
  type EnvironmentDescriptor,
  importDifferences,
} from "../keys/environment-descriptor.js";
import type { StoredEnvironment } from "../store/environments.js";
import type { ExportedEnvironment } from "../store/transfer-bundle.js";
import type { ProjectName } from "../types/common.js";

/**
 * Spec 018 D3 and D5: how one project's environment in an export compares
 * with the one this worktree keys it with now (D1). `unknown` before this
 * worktree's daemon recorded one; `differs` names each part when both sides
 * hold a descriptor; `passes` when they differ only in the fields an
 * imported pass may differ in (D10), named too.
 */
export type EnvironmentComparison =
  | { readonly kind: "equal" }
  | { readonly kind: "unknown" }
  | { readonly kind: "passes"; readonly differences: readonly string[] }
  | { readonly kind: "differs"; readonly differences: readonly string[] };

export function compareEnvironment(
  exported: Pick<ExportedEnvironment, "hash" | "descriptor">,
  local: StoredEnvironment | null,
): EnvironmentComparison {
  if (local === null) return { kind: "unknown" };
  if (local.hash === exported.hash) return { kind: "equal" };
  if (exported.descriptor === null || local.descriptor === null) {
    return { kind: "differs", differences: [] };
  }
  const differences = describeDifferences(exported.descriptor, local.descriptor).map((d) => d.text);
  const passes = importDifferences(exported.descriptor, local.descriptor).length === 0;
  return { kind: passes ? "passes" : "differs", differences };
}

/** node:test's config field that holds the build of Node it runs (row 018-19). */
const NODE_BUILD = "nodeBuild";

/** Spec 018 D19: one project's environments, which differ, as Node sees them. */
export interface NodeGap {
  /** The export's and this worktree's Node, when they differ. */
  readonly versions: readonly [string, string] | null;
  /** With this worktree's Node, the export would key as here (D10's tolerance applied). */
  readonly onlyNode: boolean;
}

/**
 * Spec 018 D19: whether two differing environments differ in Node, and in
 * nothing else that keys an imported pass. A Node of another version is
 * also another build, so node:test's `nodeBuild` field goes with it. Without
 * both descriptors nothing is known: no versions, not Node only.
 */
export function nodeGap(
  exported: EnvironmentDescriptor | null,
  local: EnvironmentDescriptor | null,
): NodeGap {
  if (exported === null || local === null) return { versions: null, onlyNode: false };
  const versions: NodeGap["versions"] =
    exported.nodeVersion === local.nodeVersion ? null : [exported.nodeVersion, local.nodeVersion];
  const build = local.config[NODE_BUILD];
  const sameNode: EnvironmentDescriptor = {
    ...exported,
    nodeVersion: local.nodeVersion,
    config:
      build === undefined || exported.config[NODE_BUILD] === undefined
        ? exported.config
        : { ...exported.config, [NODE_BUILD]: build },
  };
  return { versions, onlyNode: importDifferences(sameNode, local).length === 0 };
}

/** One line per comparison, as `squeal import` prints it; a named project is named. */
export function comparisonText(project: ProjectName, comparison: EnvironmentComparison): string {
  const name = project === "" ? "Environment" : `Environment of project ${JSON.stringify(project)}`;
  switch (comparison.kind) {
    case "equal":
      return `${name}: equal to this worktree's`;
    case "passes":
      return `${name}: equal to this worktree's for imported passes; ${comparison.differences.join("; ")}`;
    case "unknown":
      return `${name}: none recorded for this worktree yet; squeal status --full compares them once its daemon keyed the files`;
    case "differs":
      return comparison.differences.length === 0
        ? `${name}: differs from this worktree's; one side holds no record of its parts`
        : `${name}: differs from this worktree's: ${comparison.differences.join("; ")}`;
  }
}
