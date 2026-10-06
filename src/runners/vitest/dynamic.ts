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
 */
export function expandsFromDisk(file: AbsolutePath, transform: object): boolean {
  if (file.includes("/node_modules/")) return false;
  let found = scanned.get(transform);
  if (found === undefined) {
    found = DYNAMIC_SPECIFIER.test(readSource(file));
    scanned.set(transform, found);
  }
  return found;
}

function readSource(file: AbsolutePath): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
