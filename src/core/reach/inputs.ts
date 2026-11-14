import type { RelativePath } from "../types/common.js";
import { walk } from "./chains.js";
import type { ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 022 D4 (review 0.1.493 B2): the input facts the narrowing estimate
 * decides from. They come from graph evidence and input evidence, never
 * from the display route of `pairs.ts`, whose precedence hides an import
 * behind a child-process label and whose fallback calls a module-shaped
 * path `import` with no edge to it.
 */

/** Why a pair's input kind cannot be proved, so the pair is not estimated. */
export type UnprovedReason = "no recorded walk" | "walk incomplete";

/** What a changed path is to one test file. */
export type InputKind =
  /** An import-graph path only: the list decides. */
  | { readonly kind: "import" }
  /** Held by an input narrowing keeps: never avoidable. */
  | { readonly kind: "kept" }
  | { readonly kind: "unproved"; readonly reason: UnprovedReason };

export interface InputFacts {
  /** The paths whose edit re-keys the test file: itself, its closure, its environment files. */
  readonly keyedBy: ReadonlySet<RelativePath>;
  /** Whether the stored edges of its keyed walk reach `path` from the test file. */
  imports(path: RelativePath): boolean;
  /** The kind of input `path` is to the test file. */
  kindOf(path: RelativePath): InputKind;
}

const IMPORT = { kind: "import" } as const;
const KEPT = { kind: "kept" } as const;

/**
 * The facts of `test`, whose closure is known. Kept inputs: the test file
 * itself, its environment files (setup, global setup, config and their
 * closures), declared inputs, observed reads and observed modules (a
 * child process's imports, and the in-process loads D2 adds, which the
 * stored maps do not tell apart). A path the complete walk does not reach
 * is a non-import input (a resolution candidate, a snapshot, a glob
 * listing), kept too. Without a walk at its key, or with one that stops at
 * an unrecorded module, nothing else is proved.
 */
export function inputFacts(test: ReachTestFile, snapshot: ReachSnapshot): InputFacts {
  const found = snapshot.graph?.walk(test.ref);
  const environment = new Set(found?.environment?.files ?? []);
  const graph =
    found === undefined
      ? null
      : walk(found.imports, [test.ref.path], (path) => snapshot.modules.hasBytes(path));
  const imports = (path: RelativePath) =>
    graph !== null && path !== test.ref.path && graph.chain(path) !== null;
  const kept = (path: RelativePath) =>
    path === test.ref.path ||
    environment.has(path) ||
    test.childProcess.has(path) ||
    test.runtimeRead.has(path) ||
    snapshot.declared(test.ref.path, path) !== null;
  return {
    keyedBy: new Set([test.ref.path, ...(test.closure ?? []), ...environment]),
    imports,
    kindOf(path) {
      if (kept(path)) return KEPT;
      if (graph === null) return { kind: "unproved", reason: "no recorded walk" };
      if (imports(path)) return IMPORT;
      return graph.incomplete ? { kind: "unproved", reason: "walk incomplete" } : KEPT;
    },
  };
}
