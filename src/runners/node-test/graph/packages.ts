import { compare } from "../../../core/fs/index.js";
import type { PackageImport, RelativePath, RunnerPackages } from "../../../core/types/index.js";

/**
 * The builtin Spec 001 D3 sends to the whole fingerprint that a module
 * reports for a load no specifier names (task 003-22), as Vitest's
 * closures do: like `module` itself, it can reach any package.
 */
export const UNNAMED = "module";

/** A builtin's name without `node:` or a subpath: `fs` for `node:fs/promises`. */
export function builtinName(specifier: string): string {
  const name = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return name.split("/")[0] ?? name;
}

/** The package a bare specifier names (`@s/p/sub` is `@s/p`), or `null` for anything else. */
export function packageName(specifier: string): string | null {
  if (specifier === "" || /^[./\\\0#]/.test(specifier) || specifier.includes(":")) return null;
  return /^(?:@[^/]+\/)?[^/]+/.exec(specifier)?.[0] ?? null;
}

/**
 * The `PackageImport` of a bare specifier looked up from `from` (001 D3,
 * task 001-105); a read of the package's own `package.json` loads no code
 * and is marked (task 001-109, N2). `null` for a specifier no package name
 * stands for.
 */
export function packageImport(from: RelativePath, specifier: string): PackageImport | null {
  const name = packageName(specifier);
  if (name === null) return null;
  return specifier === `${name}/package.json` ? { from, name, manifest: true } : { from, name };
}

const NODE_MODULES = "node_modules/";

/**
 * The package an installed file belongs to, from its worktree-relative path
 * (task 003-33, review wave-3 B1), as Vitest's `installedEntry` has it: the
 * name after the last `node_modules/`, scoped or not, looked up from the
 * directory holding that `node_modules`; its own `package.json` marked.
 * `null` for a file under `node_modules` in no package (`.bin`, `.cache`),
 * which the caller reports as {@link UNNAMED}.
 */
export function installedPackage(path: RelativePath): PackageImport | null {
  const at = path.lastIndexOf(NODE_MODULES);
  if (at === -1 || (at > 0 && path[at - 1] !== "/")) return null;
  const rest = path.slice(at + NODE_MODULES.length);
  const name = packageName(rest);
  // `node_modules/@scope` itself, as a glob can match it, is no package.
  if (name === null || (name.startsWith("@") && !name.includes("/"))) return null;
  const from = path.slice(0, Math.max(0, at - 1));
  return rest === `${name}/package.json` ? { from, name, manifest: true } : { from, name };
}

/** First-hop packages and builtins gathered over modules, duplicates dropped. */
export class PackageSet {
  private readonly imports = new Map<string, PackageImport>();
  private readonly builtins = new Set<string>();

  add(imports: readonly PackageImport[], builtins: readonly string[] = []): void {
    for (const entry of imports) {
      this.imports.set(`${entry.from}\0${entry.name}\0${entry.manifest === true}`, entry);
    }
    for (const name of builtins) this.builtins.add(name);
  }

  packages(runner?: readonly PackageImport[]): RunnerPackages {
    return {
      imports: [...this.imports.values()],
      builtins: [...this.builtins].sort(compare),
      ...(runner === undefined ? {} : { runner }),
    };
  }
}
