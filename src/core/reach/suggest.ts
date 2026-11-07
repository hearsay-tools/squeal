import { plural } from "../text.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Evidence, FileReach, Route } from "./analyze.js";
import { targetsIn } from "./chains.js";
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

/** 015-116 (P6): the module that imports the file and many of its siblings, after a barrel or helper gateway. */
export interface SecondGateway {
  readonly gateway: RelativePath;
  readonly suggestion: Suggestion;
}

/** The note for a route Squeal re-runs by design. */
export const BY_DESIGN = "these tests start the program from source; Squeal re-runs them by design";

/** `a → b → c`. */
export const chainText = (chain: readonly RelativePath[]) => chain.join(" → ");

/**
 * Whether `file` leaves the closure of the tests that load it through
 * `route`'s barrel with `export type *`: the barrel re-exports it with
 * `export *` and it exports no runtime value (015-116, P4).
 */
export function typesOnlyThrough(file: RelativePath, route: Route, snapshot: ReachSnapshot) {
  const { modules } = snapshot;
  if (route.kind !== "barrel" || route.gateway === null) return false;
  if (modules.exportsValue(file) !== false) return false;
  return modules.starTargets(route.gateway, route.test).has(file);
}

/**
 * The suggestion for `files`, which share `route`, the main route of
 * `lead`, one of them; `null` for a kind that has none.
 */
export function suggestionFor(
  files: readonly RelativePath[],
  route: Route,
  snapshot: ReachSnapshot,
  lead: FileReach,
): Suggestion | null {
  const text = textFor(files, route, snapshot, lead);
  return text === null ? null : { kind: route.kind, text };
}

function textFor(
  files: readonly RelativePath[],
  route: Route,
  snapshot: ReachSnapshot,
  lead: FileReach,
): string | null {
  const [first = ""] = files;
  const them = files.length === 1 ? first : "these files";
  const { gateway } = route;
  switch (route.kind) {
    case "barrel":
      return gateway === null ? null : barrelText(files, them, gateway, route, snapshot);
    case "test helper":
      return gateway === null ? null : helperText(them, gateway, route);
    case "transitive": {
      if (gateway === null) return null;
      const evidence = lead.through.get(gateway);
      return siblingText(first, them, gateway, route.test, snapshot, evidence);
    }
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
  route: Route,
  snapshot: ReachSnapshot,
): string {
  if (files.every((f) => typesOnlyThrough(f, route, snapshot))) {
    const [exports, it] = files.length === 1 ? ["exports", "it"] : ["export", "them"];
    return `${exports} no runtime value: tests re-run because ${barrel} re-exports ${it} with \`export *\`; \`export type *\` takes ${it} out of their closure`;
  }
  const own = files.length === 1 ? "its own path" : "their own paths";
  return `import ${them} from ${own} in the files that use ${files.length === 1 ? "it" : "them"}, or split ${barrel}`;
}

function helperText(them: string, helper: RelativePath, route: Route): string | null {
  const loads = `${plural(route.testFiles, "test file")} that load ${them} through it`;
  if (route.measured === 0)
    return `split ${helper}: Squeal cannot tell which of the ${loads} call it`;
  // 015-116 (P5): every test file that can tell calls it, so a split spares none of them.
  if (route.uncalled === 0) return null;
  return `split ${helper}: ${route.uncalled} of the ${loads} never call it`;
}

/**
 * 015-116 (P6, D11 as amended): the module on the route's chain that
 * imports the file and many of its siblings, when a barrel or helper
 * before it is the gateway. Cezar's runner factory, which loads all six
 * runners, sits after its parity testkits on the chain.
 */
export function secondGateway(
  files: readonly RelativePath[],
  route: Route,
  snapshot: ReachSnapshot,
  lead: FileReach,
): SecondGateway | null {
  if (route.kind !== "barrel" && route.kind !== "test helper") return null;
  const file = route.chain.at(-1);
  const importer = route.chain.at(-2);
  if (file === undefined || importer === undefined || importer === route.gateway) return null;
  const them = files.length === 1 ? file : "these files";
  const evidence = lead.through.get(importer);
  const text = siblingText(file, them, importer, route.test, snapshot, evidence);
  return text === null ? null : { gateway: importer, suggestion: { kind: "transitive", text } };
}

/**
 * D11's text for a module that imports many siblings, with its evidence as
 * the helper text gives it (015-121): the test files that load the file
 * through the module and never call it. With none, it is left out.
 */
function siblingText(
  file: RelativePath,
  them: string,
  importer: RelativePath,
  test: TestFileRef,
  snapshot: ReachSnapshot,
  evidence: Evidence | undefined,
): string | null {
  const walked = snapshot.graph?.walk(test);
  const targets = walked === undefined ? undefined : targetsIn(walked.imports, importer);
  const siblings = siblingsAmong(file, targets ?? []);
  if (siblings.length < 2 || evidence === undefined) return null;
  const [where, it] = them === file ? ["it is", "it"] : ["they are", "them"];
  const loads = `${plural(evidence.testFiles, "test file")} that load ${them} through ${importer}`;
  let count: string;
  if (evidence.measured === 0) count = `Squeal cannot tell which of the ${loads} call ${it}`;
  else if (evidence.uncalled === 0) return null;
  else count = `${evidence.uncalled} of the ${loads} never call ${it}`;
  return `load ${them} only where ${where} used: ${importer} imports ${siblings.length} sibling modules, so each test file that loads it loads them all; ${count}; for example, a registry that each test fills`;
}

function setupText(them: string, chain: readonly RelativePath[]): string {
  // Review 0.1.415 B3: no recorded edge from a root reaches it, so no chain is named.
  if (chain.length === 0) {
    return `keep the setup's imports leaf-only; the chain from a setup or config file to ${them} is not recorded`;
  }
  const [root = ""] = chain;
  if (isConfigPath(root) && chain.length === 2) {
    return them === "these files"
      ? `${root} imports these files: name them by path, or load them only where they are used`
      : `${root} imports ${them}: name it by path, or load it only where it is used`;
  }
  if (chain.length < 2) {
    return them === "these files"
      ? "these files are setup files: keep their imports leaf-only"
      : `${them} is a setup file: keep its imports leaf-only`;
  }
  return `keep the setup's imports leaf-only: ${chainText(chain)}`;
}
