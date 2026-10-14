import type { AbsolutePath } from "../../core/types/index.js";
import type { VitestNode } from "./load.js";

/** Policy `vitest.excludeProjects` as the instance starts with it (spec 001 D11). */
export interface Exclusion {
  /** Vitest's `project` option; `undefined` leaves the config's own filter alone. */
  readonly project: string[] | undefined;
  /** One problem per name no project has; never rejects. */
  readonly unknown: Promise<string[]>;
}

/**
 * Policy `vitest.excludeProjects` (spec 001 D11, tasks 001-349, 001-370) as
 * Vitest's own `project` option: Vitest 5 drops a project a `!name` entry
 * matches, with the projects nested under it and its browser instances,
 * after it resolves the configs and before it creates any project, so an
 * excluded project has no server, no global setup and no test file to list.
 * Vitest matches each name as `--project` does: `*` is a wildcard, case aside.
 *
 * The option replaces a config's own `test.project` filter rather than
 * joining it, so the list may only narrow what Vitest runs when it carries
 * that filter too: its positives still select, and any `!` drops. Reading
 * the filter resolves the config once before the instance; with no filter
 * there, that resolution saw every project and the unknown-name check uses
 * it, otherwise the check resolves again beside the instance, filter cleared.
 */
export async function exclusion(
  node: VitestNode,
  root: AbsolutePath,
  names: readonly string[],
): Promise<Exclusion> {
  if (names.length === 0) return { project: undefined, unknown: Promise.resolve([]) };
  const configured = await resolveProjects(node, { root, watch: false });
  const project = [...configured.filter, ...names.map((name) => `!${name}`)];
  const unknown =
    configured.filter.length === 0
      ? Promise.resolve(unknownIn(names, configured.known))
      : unknownExclusions(node, root, names);
  return { project, unknown };
}

/**
 * One problem per name no project of the config has, in the `slow.include`
 * form (005-57 reuses it). The config is resolved with its own project
 * filter cleared (`project: []`, review wave-13bl B1), so every project is a
 * candidate, and no project is created for it. A config that fails to
 * resolve fails the instance too, which says why; this reports nothing then.
 */
export async function unknownExclusions(
  node: VitestNode,
  root: AbsolutePath,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  try {
    return unknownIn(
      names,
      (await resolveProjects(node, { root, watch: false, project: [] })).known,
    );
  } catch {
    return [];
  }
}

function unknownIn(names: readonly string[], known: readonly string[]): string[] {
  return names.flatMap((name, index) =>
    known.some((project) => matches(name, project))
      ? []
      : [
          `"vitest.excludeProjects[${index}]" names no Vitest project (${JSON.stringify(name)}); it is left out`,
        ],
  );
}

/** The config's own project filter, and every name and ancestor that filter left. */
async function resolveProjects(
  node: VitestNode,
  options: { root: AbsolutePath; watch: false; project?: string[] },
): Promise<{ filter: readonly string[]; known: readonly string[] }> {
  // Vite's type has `test` only where Vitest's augmentation is loaded; `ancestors` is internal.
  const config = (await node.resolveConfig(options)) as {
    readonly test?: {
      readonly project?: readonly string[];
      readonly resolvedProjects?: readonly ResolvedEntry[];
    };
  };
  const entries = config.test?.resolvedProjects ?? [];
  return {
    filter: config.test?.project ?? [],
    known: entries.flatMap((entry) => [entry.projectConfig.name, ...(entry.ancestors ?? [])]),
  };
}

/** A project as Vitest resolved it, and the projects it is declared under, which the filter matches too. */
interface ResolvedEntry {
  readonly projectConfig: { readonly name: string };
  readonly ancestors?: readonly string[];
}

/** Vitest 5's `wildcardPatternToRegExp`, which its project filter uses. */
function matches(pattern: string, name: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`, "i").test(name);
}
