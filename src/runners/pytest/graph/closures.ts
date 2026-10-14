import type { AbsolutePath } from "../../../core/types/index.js";
import type { ModuleNode } from "./modules.js";

/** One test file's closure before it is made relative. */
export interface RawClosure {
  readonly members: ReadonlySet<AbsolutePath>;
  readonly incomplete: readonly string[];
}

/**
 * Spec 007 D4's closures of every test file and the reverse index from a
 * path to the test files whose closure holds it, rebuilt whole when a
 * module's edges changed.
 */
export class ClosureIndex {
  readonly closures = new Map<AbsolutePath, RawClosure>();
  private readonly holders = new Map<AbsolutePath, AbsolutePath[]>();

  constructor(
    node: (path: AbsolutePath) => ModuleNode | undefined,
    roots: ReadonlyMap<AbsolutePath, readonly AbsolutePath[]>,
  ) {
    for (const [testFile, conftests] of roots) {
      const closure = walk(node, [testFile, ...conftests]);
      this.closures.set(testFile, closure);
      for (const path of closure.members) {
        const list = this.holders.get(path);
        if (list === undefined) this.holders.set(path, [testFile]);
        else list.push(testFile);
      }
    }
  }

  holdersOf(path: AbsolutePath): readonly AbsolutePath[] {
    return this.holders.get(path) ?? [];
  }
}

/**
 * The file, its conftest chain, the transitive static closure of both, the
 * `pytest_plugins` of every module pytest loads as a test, conftest or
 * plugin, and every reached module's candidates.
 */
function walk(
  node: (path: AbsolutePath) => ModuleNode | undefined,
  roots: readonly AbsolutePath[],
): RawClosure {
  const members = new Set<AbsolutePath>();
  const visited = new Set<AbsolutePath>();
  const plugins = new Set<AbsolutePath>();
  const incomplete = new Set<string>();
  const todo: [AbsolutePath, boolean][] = roots.map((path) => [path, true]);
  while (todo.length > 0) {
    const [path, pytestModule] = todo.pop() as [AbsolutePath, boolean];
    members.add(path);
    if (pytestModule ? plugins.has(path) : visited.has(path)) continue;
    if (pytestModule) plugins.add(path);
    const first = !visited.has(path);
    visited.add(path);
    const module = node(path);
    if (module === undefined) continue;
    if (first) {
      for (const dep of module.deps) if (!visited.has(dep)) todo.push([dep, false]);
      for (const candidate of module.candidates) members.add(candidate);
      for (const reason of module.incomplete) incomplete.add(reason);
    }
    if (pytestModule) for (const plugin of module.plugins) todo.push([plugin, true]);
  }
  return { members, incomplete: [...incomplete].sort() };
}
