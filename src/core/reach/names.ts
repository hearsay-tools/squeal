import { posix } from "node:path";
import type { RelativePath } from "../types/common.js";

/*
 * Spec 015 D11: the name rules the report settles (row 015-109), checked
 * against both research repositories (`research/edit-reach.md`): squeal's
 * helpers are its `test/**` modules, cezar's its `*.testkit.ts` files, its
 * `test-*.mjs` scripts and the modules under its `test`, `fixtures` and
 * `e2e` folders; cezar's runner factory imports six `*-runner.ts` siblings.
 */

/** Folders whose modules serve tests: `test/**`, `__tests__/**`, `fixtures/**` and the like. */
const HELPER_FOLDERS: ReadonlySet<string> = new Set([
  "test",
  "tests",
  "__tests__",
  "testing",
  "test-utils",
  "test-helpers",
  "testkit",
  "fixtures",
  "__fixtures__",
  "__mocks__",
  "mocks",
  "e2e",
]);

/** `*.testkit.*`, `*.test-utils.*`, `*.fixture.*`, `test-*.*`. */
const HELPER_NAME =
  /\.(?:testkit|test-utils|test-helpers|fixtures?|mocks?)\.[^.]+$|^test-[^/]*\.[^.]+$/;

/**
 * A module the runner does not list as a test that serves tests by its
 * name: under a test folder, or named as a test kit. The caller leaves out
 * listed test files. Squeal has no notion of a project's source roots, so
 * "outside them" is read from the folder names.
 */
export function isHelperPath(path: RelativePath): boolean {
  const segments = path.split("/");
  const name = segments.pop() ?? "";
  return segments.some((s) => HELPER_FOLDERS.has(s)) || HELPER_NAME.test(name);
}

/** A config file of the runner, whose imports a setup chain may start at. */
export function isConfigPath(path: RelativePath): boolean {
  return /(?:^|\/)(?:vitest|vite)\.(?:config|workspace)\.[^/]+$/.test(path);
}

/** `claude-cli-runner.ts` → `runner.ts`: the part after the last `-`, or the whole name. */
function suffixOf(name: string): string {
  const at = name.lastIndexOf("-");
  return at < 0 ? name : name.slice(at + 1);
}

/**
 * Two modules are siblings when they share a folder and a name suffix
 * (`core/claude-cli-runner.ts`, `core/pi-runner.ts`), or a name and a
 * grandparent folder (`runners/vitest/adapter.ts`, `runners/pytest/adapter.ts`).
 */
export function areSiblings(a: RelativePath, b: RelativePath): boolean {
  if (a === b) return false;
  const [da, db] = [posix.dirname(a), posix.dirname(b)];
  const [na, nb] = [posix.basename(a), posix.basename(b)];
  if (da === db) return suffixOf(na) === suffixOf(nb) && na !== nb;
  return na === nb && da !== "." && db !== "." && posix.dirname(da) === posix.dirname(db);
}

/** Of `targets`, `file` and its siblings: more than one means `targets` imports many siblings of it. */
export function siblingsAmong(
  file: RelativePath,
  targets: readonly RelativePath[],
): readonly RelativePath[] {
  return targets.filter((t) => t === file || areSiblings(t, file));
}
