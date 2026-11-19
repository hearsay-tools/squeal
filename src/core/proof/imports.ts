import { extname, posix } from "node:path";
import { isConfigPath, isHelperPath } from "../reach/names.js";
import type { RelativePath } from "../types/common.js";
import { isTestSide } from "./sides.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 (the human on issue #247, "A: explain
 * + --with"; row 023-21, repaired after `reviews/wave-14.md` B1): a named
 * test that is unchanged in `base..HEAD` while files its closure imports
 * (directly or not, added ones too) changed. A changed import on the test
 * side (`isTestSide`, `--with` paths included) is copied with the test
 * version already. A code-side one is test code when its own text, at
 * `HEAD` or at `base`, imports a test API (`testApiOf`), or when it is
 * pytest's `conftest.py`, or has a test helper's name (`isHelperPath`, an
 * extra signal only): the file does not run and the report names it with
 * the `--with` rerun. Every other changed import is source, compared as
 * before, and the report names it. Known blind spot: a test helper that
 * imports no test API and has an ordinary name (pure data rows) counts as
 * source (`tasks/023-21-notes.md`).
 */

/** One changed import taken for test code, and the evidence. */
export interface TestCode {
  readonly path: RelativePath;
  /** `imports vitest at <sha>`, `pytest's conftest.py`, `a test helper's name`. */
  readonly why: string;
}

/** A named test's changed imports while the test itself is unchanged. */
export interface ChangedImports {
  /** Code-side imports taken for test code: the `--with` candidates. With any, the file does not run. */
  readonly testCode: readonly TestCode[];
  /** The other code-side changed imports: source the case compares, or runs at `HEAD` on both sides. */
  readonly sources: readonly RelativePath[];
  /** A changed import on the test side (named, `--with`, or by `isTestSide`), copied already. */
  readonly testSide: boolean;
}

/**
 * The code-side paths of `file`'s closure `loads` that `changed` (the diff
 * `base..HEAD`) holds, when `file` itself is unchanged; empty otherwise.
 * `testSide` holds the named files and the `--with` paths.
 */
export function codeSideChanges(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
): { readonly code: RelativePath[]; readonly testSide: boolean } {
  if (changed.has(file)) return { code: [], testSide: false };
  const touched = [...new Set(loads)].filter((path) => path !== file && changed.has(path)).sort();
  const code = touched.filter((path) => !isTestSide(path, testSide));
  return { code, testSide: code.length < touched.length };
}

/**
 * `file`'s changed imports, each code-side one split by `whyTestCode`
 * (`testCodeWhy` over its texts); `null` when `file` changed or no
 * code-side import did.
 */
export function changedImports(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
  whyTestCode: (path: RelativePath) => string | null,
): ChangedImports | null {
  const side = codeSideChanges(file, loads, changed, testSide);
  if (side.code.length === 0) return null;
  const testCode: TestCode[] = [];
  const sources: RelativePath[] = [];
  for (const path of side.code) {
    const why = whyTestCode(path);
    if (why === null) sources.push(path);
    else testCode.push({ path, why });
  }
  return { testCode, sources, testSide: side.testSide };
}

/** A file's text at one commit; `null` when the commit lacks it. */
export interface Version {
  readonly commit: string;
  readonly text: string | null;
}

/**
 * Why `path` is test code, from its texts at `HEAD` and at `base`; `null`
 * when nothing shows it. A runner config is never taken for test code: it
 * imports `vitest/config`, and it is compared as source.
 */
export function testCodeWhy(path: RelativePath, versions: readonly Version[]): string | null {
  if (isConfigPath(path)) return null;
  for (const { commit, text } of versions) {
    const api = text === null ? null : testApiOf(path, text);
    if (api !== null) return `imports ${api} at ${commit.slice(0, 9)}`;
  }
  if (posix.basename(path) === "conftest.py") return "pytest's conftest.py";
  return isHelperPath(path) ? "a test helper's name" : null;
}

/**
 * The test APIs of Squeal's runners and the libraries commonly run under
 * them: Vitest, node:test and pytest themselves, then `expect` libraries,
 * Playwright Test, Jest's globals, Testing Library and `unittest`.
 */
const JS_TEST_APIS = [
  "vitest",
  "@vitest/",
  "node:test",
  "@playwright/test",
  "@jest/globals",
  "chai",
  "sinon",
  "@testing-library/",
];
const PY_TEST_APIS = ["pytest", "_pytest", "unittest"];

const JS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
/** `from "x"`, `import "x"`, `import("x")`, `require("x")`: each module specifier. */
const JS_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]+)["']/g;
/** `import x`, `import x.y`, `from x import`, `from x.y import`: each top-level module. */
const PY_IMPORT = /^[ \t]*(?:import|from)[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm;

/** The first test API `text` imports, by `path`'s language; `null` for none. */
export function testApiOf(path: RelativePath, text: string): string | null {
  const ext = extname(path);
  if (JS_EXTENSIONS.has(ext)) {
    for (const [, specifier] of text.matchAll(JS_SPECIFIER))
      if (specifier !== undefined && JS_TEST_APIS.some((api) => isModule(specifier, api)))
        return specifier;
    return null;
  }
  if (ext === ".py")
    for (const [, module] of text.matchAll(PY_IMPORT))
      if (module !== undefined && PY_TEST_APIS.includes(module)) return module;
  return null;
}

/** `specifier` is module `api` or a subpath of it (`api` ending in `/` is a scope). */
function isModule(specifier: string, api: string): boolean {
  return api.endsWith("/")
    ? specifier.startsWith(api)
    : specifier === api || specifier.startsWith(`${api}/`);
}

/**
 * Whether the file stops (exit 3, nothing run): a changed code-side
 * import is test code while the test did not change. Without one the file
 * runs; with only source changes and no test-side change, the report
 * notes what it compares as source.
 */
export function stops(imports: ChangedImports | null): boolean {
  return imports !== null && imports.testCode.length > 0;
}

/** The `--with` paths no named test's closure loads: each reads a warning, not an error. */
export function unusedWith(
  withPaths: readonly RelativePath[],
  loads: readonly (readonly RelativePath[])[],
): RelativePath[] {
  const loaded = new Set(loads.flat());
  return withPaths.filter((path) => !loaded.has(path));
}
