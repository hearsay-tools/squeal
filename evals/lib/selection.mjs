// Which test files a run selects, by its runner's rule (spec 006 D4 as amended 2026-10-11): one
// rule for whether Squeal had answered a run's scope and whether a run covered the affected
// tests, so `vitest run test/money` and `vitest run test/money.test.ts` select the same file.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The fixture's Vitest `include`: every `.test.ts` file under `test/`. */
const VITEST_TEST = /^test\/(?:.*\/)?[^/]+\.test\.ts$/;

/** The fixture's own Vitest test files, as its `include` lists them. */
const FIXTURE_TESTS = readdirSync(fileURLToPath(new URL("../ledgerline/test", import.meta.url)), {
  recursive: true,
})
  .map((p) => `test/${String(p).replaceAll("\\", "/")}`)
  .filter((p) => VITEST_TEST.test(p))
  .sort();

/**
 * The Vitest test files a session's runs could select: the fixture's, those the agent wrote, and
 * those Squeal named, from timeline `tl`.
 */
export function vitestFiles(tl) {
  const files = new Set(FIXTURE_TESTS);
  for (const s of tl) {
    if (s.k === "edit" && VITEST_TEST.test(s.path)) files.add(s.path);
    for (const c of s.k === "squeal" ? (s.checks ?? []) : [])
      if (c.file && VITEST_TEST.test(c.file)) files.add(c.file);
  }
  return [...files];
}

/** Normalized test path: relative to the worktree, without `./` or a trailing slash. */
export function relTestPath(p) {
  const s = String(p);
  if (/\/work\//.test(s)) return s.replace(/^.*?\/work\//, "").replace(/\/+$/, "");
  if (s.startsWith("/")) return null;
  return s.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
}

const globRe = (g) =>
  new RegExp(
    `^${g
      .split(/\*\*\/?/)
      .map((part) =>
        part
          .replace(/[.+^${}()|\\]/g, "\\$&")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]"),
      )
      .join(".*")}$`,
  );

/**
 * Whether path `p` of a `runner`'s scope selects test file `f`: the file itself, a directory
 * above it, a glob matching it, or for Vitest a filter its path contains.
 */
export function selects(p, f, runner) {
  const q = relTestPath(p);
  if (q === null) return false;
  if (q === "" || q === "." || q === f || f.startsWith(`${q}/`)) return true;
  if (/[*?[]/.test(q)) return globRe(q).test(f);
  return runner === "vitest" && f.includes(q);
}

/**
 * Whether `scope` narrows the tests it runs within the files it selects, or by a rule the
 * grader cannot resolve: a name or skip filter, `--test-only`, a project or a shard. Failing
 * closed (review wave 2.6, B3), such a run runs no affected test file in full.
 */
export const filtered = (scope) =>
  !!(
    scope.names?.length ||
    scope.skip?.length ||
    scope.only ||
    scope.projects?.length ||
    scope.shard
  );

/**
 * Whether `scope` (`{ full: true }` or `{ full: false, paths }`, with `exclude`) selects test
 * file `f`. An excluded file is matched as broadly as a selected one, failing closed; `related`
 * and `--changed` selections are not resolved and select nothing.
 */
export function selectsFile(scope, f, runner) {
  if (typeof scope !== "object" || scope === null) return false;
  if ((scope.exclude ?? []).some((x) => selects(x, f, "vitest"))) return false;
  if (scope.related || scope.changed) return false;
  if (scope.full) return true;
  return (scope.paths ?? []).some((p) => selects(p, f, runner));
}

/**
 * Whether `scope` runs every test of one of `files`: it selects the file and neither excludes it
 * nor filters its tests (review wave 2.6, B3). A name filter is never the full suite.
 */
export function covers(scope, files, runner) {
  if (typeof scope !== "object" || scope === null || filtered(scope)) return false;
  return files.some((f) => selectsFile(scope, f, runner));
}
