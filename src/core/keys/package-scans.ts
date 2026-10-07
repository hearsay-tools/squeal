import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../types/index.js";

/**
 * Files a package can ship without anything Node loads: declarations, their
 * maps, the manifest and documentation. Anything else counts as runtime,
 * `.json` and `.ts` included, since a test can `require` the one and Vite
 * transforms the other.
 */
const NOT_RUNTIME = [
  /\.d\.[cm]?ts(?:\.map)?$/,
  /^package\.json$/,
  /\.(?:md|markdown|txt)$/i,
  /^(?:licen[cs]e|readme|changelog|notice|authors|history|copying)(?:[.-].*)?$/i,
];

/** Files a package's code can be in: what Node and Vite load, declarations left out. */
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/**
 * A reference in package code to a builtin that can load a package no import
 * names (`OPAQUE_BUILTINS`): `child_process` and `worker_threads` as any
 * string literal, `module` and `cluster` as a `node:` specifier or the
 * argument of `require`, `import`, `from` or `getBuiltinModule`. `require`
 * without a word boundary matches bundlers' `__require`.
 */
const OPAQUE_REFERENCE =
  /(["'`])(?:node:)?(?:child_process|worker_threads)\1|(["'`])node:(?:module|cluster)\2|(?:require|\bimport|\bfrom|getBuiltinModule)\s*\(?\s*(["'`])(?:module|cluster)\3/;

/**
 * On-disk scans of installed packages, by identity (`InstalledGraph`), kept
 * across installs so a re-read of an unchanged install scans nothing.
 *
 * Spec 001 D3 (tasks 001-105, 001-109): a package with no runtime file keys
 * as a constant; a package whose code reaches `child_process`,
 * `worker_threads`, `module` or `cluster` is opaque and sends the test files
 * whose closure holds it to the whole fingerprint.
 */
export class PackageScans {
  readonly #typesOnly = new Map<string, boolean>();
  readonly #opaque = new Map<string, boolean>();
  /** Opaque scans done, and the time they took, for measurement. */
  scanned = 0;
  scanMs = 0;

  /** Whether the package at `dir` ships no file Node could load. */
  typesOnly(identity: string, dir: AbsolutePath): boolean {
    let known = this.#typesOnly.get(identity);
    if (known === undefined) {
      known = !hasRuntimeFile(dir);
      this.#typesOnly.set(identity, known);
    }
    return known;
  }

  /** Whether the code of the package at `dir` references an opaque builtin. */
  opaque(identity: string, dir: AbsolutePath): boolean {
    let known = this.#opaque.get(identity);
    if (known === undefined) {
      const start = performance.now();
      known = referencesOpaque(dir);
      this.scanMs += performance.now() - start;
      this.scanned += 1;
      this.#opaque.set(identity, known);
    }
    return known;
  }
}

/** Whether a package folder ships a file Node could load. Unreadable counts as yes. */
function hasRuntimeFile(dir: AbsolutePath): boolean {
  const entries = entriesOf(dir);
  if (entries === null) return true;
  return entries.some((entry) => {
    if (entry.name === "node_modules") return false;
    if (entry.isDirectory()) return hasRuntimeFile(join(dir, entry.name));
    return !NOT_RUNTIME.some((pattern) => pattern.test(entry.name));
  });
}

/**
 * Whether a code file in a package folder, nested packages left out,
 * references an opaque builtin. Unreadable counts as yes.
 */
function referencesOpaque(dir: AbsolutePath): boolean {
  const entries = entriesOf(dir);
  if (entries === null) return true;
  return entries.some((entry) => {
    if (entry.name === "node_modules") return false;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return referencesOpaque(path);
    if (!entry.isFile() || !CODE.test(entry.name) || DECLARATION.test(entry.name)) return false;
    try {
      return OPAQUE_REFERENCE.test(readFileSync(path, "utf8"));
    } catch {
      return true;
    }
  });
}

function entriesOf(dir: AbsolutePath): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}
