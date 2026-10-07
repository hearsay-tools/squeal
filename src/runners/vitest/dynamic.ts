import { readFileSync } from "node:fs";
import type { AbsolutePath } from "../../core/types/index.js";

/** `import.meta.glob(...)`, or `import(` with a template literal that interpolates. */
const DYNAMIC_SPECIFIER = /import\.meta\.glob|\bimport\s*\(\s*`[^`]*\$\{/;

/** Scan results, one per transform object: a re-transform is scanned again. */
const scanned = new WeakMap<object, boolean>();

/**
 * True when a module's imports are expanded from the files on disk at
 * transform time: `import.meta.glob` and template-literal dynamic imports.
 * Any add can change such an expansion (spec 001 D4, reviews/wave-7.md B1).
 *
 * Reads the source on disk, never the code Vite emitted, which has the
 * expansion done. The same path for every project: Vitest does not pass a
 * plugin given at `createVitest` to a project with its own Vite server.
 *
 * `node_modules` is scanned too: only a module with a cached transform gets
 * here, so a dependency Vitest inlines, never one it externalizes. A module
 * with no source on disk, served by a plugin's `load`, counts as expanding
 * (reviews/wave-7.5.md B1): there are few, and their transforms are cheap.
 */
export function expandsFromDisk(file: AbsolutePath, transform: object): boolean {
  let found = scanned.get(transform);
  if (found === undefined) {
    const source = readSource(file);
    found = source === null || DYNAMIC_SPECIFIER.test(source);
    scanned.set(transform, found);
  }
  return found;
}

function readSource(file: AbsolutePath): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
