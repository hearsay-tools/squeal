import { plural } from "../text.js";
import type { RelativePath } from "../types/common.js";
import type { Route } from "./analyze.js";
import { targetsOf } from "./chains.js";
import { isConfigPath, siblingsAmong } from "./names.js";
import type { PathKind } from "./pairs.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "Suggestions": one per entry, by the path kind of its main
 * route, never by a threshold. A suggestion is evidence and an option, not
 * an instruction. Child processes and runtime reads get a note instead:
 * Squeal re-runs those tests by design, and their seconds are never called
 * avoidable.
 */

export interface Suggestion {
  readonly kind: PathKind;
  readonly text: string;
}

/** The note for a route Squeal re-runs by design. */
export const BY_DESIGN = "these tests start the program from source; Squeal re-runs them by design";

/** `a → b → c`. */
export const chainText = (chain: readonly RelativePath[]) => chain.join(" → ");

/** The suggestion for `files`, which share `route`; `null` for a kind that has none. */
export function suggestionFor(
  files: readonly RelativePath[],
  route: Route,
  snapshot: ReachSnapshot,
): Suggestion | null {
  const text = textFor(files, route, snapshot);
  return text === null ? null : { kind: route.kind, text };
}

function textFor(
  files: readonly RelativePath[],
  route: Route,
  snapshot: ReachSnapshot,
): string | null {
  const [first = ""] = files;
  const them = files.length === 1 ? first : "these files";
  const { gateway } = route;
  switch (route.kind) {
    case "barrel":
      return gateway === null ? null : barrelText(files, them, gateway, snapshot);
    case "test helper":
      return gateway === null ? null : helperText(them, gateway, route);
    case "transitive":
      return gateway === null ? null : siblingText(first, them, gateway, snapshot);
    case "setup":
      return setupText(them, route.chain);
    case "declared input": {
      const declared = route.declared;
      if (declared === undefined) return null;
      const scope =
        declared.tests === null ? "every test file" : `the test files "${declared.tests}" matches`;
      return `the input "${declared.input}" in squeal.config.json gives ${them} to ${scope}: ${plural(route.testFiles, "test file")} here`;
    }
    default:
      return null;
  }
}

function barrelText(
  files: readonly RelativePath[],
  them: string,
  barrel: RelativePath,
  snapshot: ReachSnapshot,
): string {
  const stars = snapshot.modules.starTargets(barrel);
  const empty = files.every((f) => snapshot.modules.functions(f) === 0 && stars.has(f));
  if (empty) {
    const holds = files.length === 1 ? "holds" : "hold";
    return `${holds} no functions: tests re-run because ${barrel} re-exports ${files.length === 1 ? "it" : "them"} with \`export *\`; \`export type *\` takes ${files.length === 1 ? "it" : "them"} out of their closure`;
  }
  const own = files.length === 1 ? "its own path" : "their own paths";
  return `import ${them} from ${own} in the files that use ${files.length === 1 ? "it" : "them"}, or split ${barrel}`;
}

function helperText(them: string, helper: RelativePath, route: Route): string {
  const loads = `${plural(route.testFiles, "test file")} that load ${them} through it`;
  if (route.measured === 0)
    return `split ${helper}: Squeal cannot tell which of the ${loads} call it`;
  return `split ${helper}: ${route.uncalled} of the ${loads} never call it`;
}

function siblingText(
  file: RelativePath,
  them: string,
  importer: RelativePath,
  snapshot: ReachSnapshot,
): string | null {
  const targets = snapshot.graph === null ? undefined : targetsOf(snapshot.graph, importer);
  const siblings = siblingsAmong(file, targets ?? []);
  if (siblings.length < 2) return null;
  const where = them === file ? "it is" : "they are";
  return `load ${them} only where ${where} used: ${importer} imports ${siblings.length} sibling modules, so each test file that loads ${importer} loads them all; for example, a registry that each test fills`;
}

function setupText(them: string, chain: readonly RelativePath[]): string {
  const [root = ""] = chain;
  if (isConfigPath(root) && chain.length === 2) {
    return `${root} imports ${them}: name it by path, or load it only where it is used`;
  }
  if (chain.length < 2) return `${them} is a setup file: keep its imports leaf-only`;
  return `keep the setup's imports leaf-only: ${chainText(chain)}`;
}
