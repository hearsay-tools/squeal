import type { AbsolutePath } from "../../core/types/index.js";
import type { VitestNode } from "./load.js";

/**
 * Policy `vitest.excludeProjects` (spec 001 D11, task 001-349) as Vitest's
 * own `project` option: Vitest 5 drops a project a `!name` entry matches,
 * with the projects nested under it and its browser instances, after it
 * resolves the configs and before it creates any project, so an excluded
 * project has no server, no global setup and no test file to list. Vitest
 * matches each name as `--project` does: `*` is a wildcard, case aside.
 */
export function projectFilter(names: readonly string[]): string[] | undefined {
  return names.length === 0 ? undefined : names.map((name) => `!${name}`);
}

/**
 * One problem per name no project of the config has, in the `slow.include`
 * form (005-57 reuses it). The created instance never knows the projects it
 * left out, so the config is resolved again, unfiltered, beside it: no
 * project is created for it. A config that fails to resolve fails the
 * instance too, which says why; this reports nothing then.
 */
export async function unknownExclusions(
  node: VitestNode,
  root: AbsolutePath,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  let known: string[];
  try {
    const config = await node.resolveConfig({ root, watch: false });
    // `ancestors` names the projects a nested one is declared under; Vitest's filter matches them too.
    const entries = (config.test?.resolvedProjects ?? []) as readonly {
      readonly projectConfig: { readonly name: string };
      readonly ancestors?: readonly string[];
    }[];
    known = entries.flatMap((entry) => [entry.projectConfig.name, ...(entry.ancestors ?? [])]);
  } catch {
    return [];
  }
  return names.flatMap((name, index) =>
    known.some((project) => matches(name, project))
      ? []
      : [
          `"vitest.excludeProjects[${index}]" names no Vitest project (${JSON.stringify(name)}); it is left out`,
        ],
  );
}

/** Vitest 5's `wildcardPatternToRegExp`, which its project filter uses. */
function matches(pattern: string, name: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`, "i").test(name);
}
