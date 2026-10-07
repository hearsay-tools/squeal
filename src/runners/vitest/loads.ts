import { readFileSync } from "node:fs";
import type { AbsolutePath } from "../../core/types/index.js";

/** A literal `require("x")`; `myrequire(` and `require(x)` do not match. */
const REQUIRE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** A `require.resolve` of one relative string literal, which names a file (review wave-11d S3). */
const RESOLVE_RELATIVE = /\brequire\s*\.\s*resolve\s*\(\s*(["'])(\.\.?\/[^"'\n]*)\1\s*\)/g;

/**
 * A load no specifier names: `require.resolve` but of one relative string
 * literal, `createRequire`, `import.meta.resolve`, and a `require(` whose
 * argument is not one string literal.
 */
const UNNAMED_LOAD =
  /\brequire\s*\.\s*resolve\b(?!\s*\(\s*(["'])\.\.?\/[^"'\n]*\1\s*\))|\bcreateRequire\b|\bimport\.meta\.resolve\b|\brequire\s*\((?!\s*(["'])[^"'\n]+\2\s*\))/;

/** Vitest's own docblock pattern (`getSpecificationsOptions`, Vitest 5). */
const DOCBLOCK_ENVIRONMENT = /@(?:vitest|jest)-environment\s+([\w-]+)\b/;

/** Packages Vitest loads for its builtin environments; `node` loads none. */
const ENVIRONMENT_PACKAGES: Readonly<Record<string, string | null>> = {
  node: null,
  jsdom: "jsdom",
  "happy-dom": "happy-dom",
  "edge-runtime": "@edge-runtime/vm",
};

/** What a module's source loads without an import Vite sees. */
export interface SourceLoads {
  /** Specifiers of literal `require` calls, and of `require.resolve` calls of a relative literal. */
  readonly requires: readonly string[];
  /** A load no specifier names, which can reach any package. */
  readonly unnamed: boolean;
  /** The environment a docblock names, which Vitest reads for a test file. */
  readonly environment: string | null;
}

/**
 * Loads in `source` the transform graph does not report (review wave-11b B1,
 * B2; task 001-109). Vitest's module runner gives every module a `require`
 * without any import, and Vite's transform deps list imports only.
 */
export function sourceLoads(source: string): SourceLoads {
  const requires: string[] = [];
  for (const pattern of [REQUIRE, RESOLVE_RELATIVE]) {
    for (const match of source.matchAll(pattern)) {
      if (match[2] !== undefined) requires.push(match[2]);
    }
  }
  const environment = DOCBLOCK_ENVIRONMENT.exec(source)?.[1] ?? null;
  return { requires, unnamed: UNNAMED_LOAD.test(source), environment };
}

/** Scan results, one per transform object: a re-transform is scanned again (D4 rule 3). */
const scanned = new WeakMap<object, SourceLoads>();

/**
 * `sourceLoads` of a module's source on disk, cached per transform, as
 * `expandsFromDisk` is. The source, never the emitted code, which rewrites
 * `import.meta`. A file that cannot be read counts as loading anything.
 */
export function moduleLoads(file: AbsolutePath, transform: object): SourceLoads {
  let loads = scanned.get(transform);
  if (loads === undefined) {
    let source: string | null = null;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      // Gone since its transform: what it loads is unknown.
    }
    loads =
      source === null ? { requires: [], unnamed: true, environment: null } : sourceLoads(source);
    scanned.set(transform, loads);
  }
  return loads;
}

/**
 * The package Vitest loads for an environment name, looked up from the
 * project root: `vitest-environment-<name>` for any but the builtins, `null`
 * for `node` and for a path, which is a file and not a package.
 */
export function environmentPackage(name: string): string | null {
  if (name in ENVIRONMENT_PACKAGES) return ENVIRONMENT_PACKAGES[name] ?? null;
  if (name.startsWith(".") || name.startsWith("/")) return null;
  return `vitest-environment-${name}`;
}
