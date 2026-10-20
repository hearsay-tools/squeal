import { posix } from "node:path";
import type { RelativePath } from "../types/index.js";

const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const MARKED_SCRIPT = /^(.+)\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const MARKED_PYTHON = /^test_(.+)\.py$|^(.+)_test\.py$/;

type Language = "script" | "python";

function languageOf(path: RelativePath): Language | null {
  if (SCRIPT.test(path)) return "script";
  return path.endsWith(".py") ? "python" : null;
}

/**
 * The name a test file tests: its basename without `.test` or `.spec` and
 * its extension, or pytest's `test_<name>.py` and `<name>_test.py`. A file
 * in a `__tests__` directory is a test by its place, so it needs no mark.
 * `null` for another language or a file without a mark.
 */
function testedName(path: RelativePath, language: Language): string | null {
  const base = posix.basename(path);
  if (language === "python") {
    const match = MARKED_PYTHON.exec(base);
    return match === null ? null : (match[1] ?? match[2] ?? null);
  }
  const match = MARKED_SCRIPT.exec(base);
  if (match !== null) return match[1] ?? null;
  const inTests = posix.basename(posix.dirname(path)) === "__tests__";
  return inTests && SCRIPT.test(base) ? base.replace(SCRIPT, "") : null;
}

/** The directories a source's tests sit in by convention: its own, its `__tests__`, the mirror of `src/`. */
function conventionalDirs(source: RelativePath): Set<string> {
  const dir = posix.dirname(source);
  const dirs = new Set([dir, posix.join(dir, "__tests__")]);
  const segments = source.split("/");
  const at = segments.indexOf("src");
  if (at >= 0 && at < segments.length - 1) {
    const prefix = segments.slice(0, at);
    const below = segments.slice(at + 1, -1);
    for (const tree of ["test", "tests"]) dirs.add(posix.join(...prefix, tree, ...below));
  }
  return dirs;
}

/**
 * Spec 011 C4 step 4 as amended 2026-10-20 (task 011-25, the human's cut
 * (n+K)): the namesakes of `source` among `testFiles`, the paths of the
 * repository's test files. A namesake is a test file of the source's name
 * with `.test` or `.spec` before its extension (pytest: `test_<name>.py`
 * or `<name>_test.py`), in the source's directory, its `__tests__`, or a
 * test tree that mirrors its path below `src/` (`src/x/b.ts` to
 * `test/x/b.test.ts` or `tests/x/b.test.ts`, under any prefix); failing
 * those, the only test file of that name in the repository. An `index`
 * has none, nor a source of no script or Python extension. On cezar 85 %
 * of an agent's changed sources had one, all siblings; on Squeal 32 %,
 * nearly all by the unique name (`research/edit-cut.md`). Row 011-43 may
 * make the patterns a project's own.
 */
export function namesakesOf(
  source: RelativePath,
  testFiles: Iterable<RelativePath>,
): RelativePath[] {
  const language = languageOf(source);
  if (language === null) return [];
  const name = posix.basename(source).replace(/\.[^.]+$/, "");
  if (name === "index") return [];
  const named = [...new Set(testFiles)].filter(
    (path) => path !== source && testedName(path, language) === name,
  );
  const dirs = conventionalDirs(source);
  const near = named.filter((path) => dirs.has(posix.dirname(path)));
  if (near.length > 0) return near;
  return named.length === 1 ? named : [];
}
