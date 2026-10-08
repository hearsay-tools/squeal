import type { AbsolutePath, RelativePath } from "../../../core/types/index.js";
import type { ModuleTable } from "./modules.js";

export interface PreloadNotesInput {
  readonly table: ModuleTable;
  /** Preloads that resolve to worktree modules, roots of the preload closure. */
  readonly roots: readonly AbsolutePath[];
  /** Bare preloads outside the worktree's modules. */
  readonly outside: readonly string[];
  readonly rules: "tsx" | "node";
  readonly rel: (path: AbsolutePath) => RelativePath;
}

/**
 * Notes for preloads: a bare one outside the worktree's modules is an
 * unrecognized loader; a worktree one whose closure imports `node:module`
 * may register module hooks, which change resolution and run in Node's
 * loader thread, where nothing is recorded (review wave 2.7, S1).
 */
export function preloadNotes({ table, roots, outside, rules, rel }: PreloadNotesInput): string[] {
  const chain = rules === "tsx" ? "tsx's" : "Node's own";
  const notes = outside.map(
    (loader) =>
      `node-test: unrecognized loader ${JSON.stringify(loader)} in argv or NODE_OPTIONS; resolving with ${chain} rules`,
  );
  for (const root of roots) {
    const hooks = importerOfModule(table, root);
    if (hooks === null) continue;
    const through = hooks === root ? "" : ` through ${JSON.stringify(rel(hooks))}`;
    notes.push(
      `node-test: preload ${JSON.stringify(rel(root))} imports node:module${through} and may register module hooks; Squeal does not record in Node's loader thread, so what the hooks load enters no key; declare it in inputs; resolving with ${chain} rules`,
    );
  }
  return notes;
}

/** The first module of a preload's closure that imports `node:module`, or `null`. */
function importerOfModule(table: ModuleTable, root: AbsolutePath): AbsolutePath | null {
  const seen = new Set([root]);
  const stack = [root];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    const hooks = table
      .specifiers(file)
      .some((s) => s.specifier === "node:module" || s.specifier === "module");
    if (hooks) return file;
    for (const dep of table.node(file)?.deps ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return null;
}
