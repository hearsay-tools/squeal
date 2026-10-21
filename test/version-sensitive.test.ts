import {
  type Dirent,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Spec 010 D4: Node 24 runs only the test files `test/version-sensitive.txt`
 * lists, so a file that reads the Node version or runs a real `node --test`
 * must be listed, every entry must still select a file, and the header names
 * the helpers that read the version, the files that import them, and the
 * node:test files exempted with a reason. Review 010-11 B1.
 */
const ROOT = join(import.meta.dirname, "..");
const LIST = readFileSync(join(ROOT, "test/version-sensitive.txt"), "utf8");
const HEADER = LIST.split("\n")
  .filter((line) => line.startsWith("#"))
  .join("\n");
const ENTRIES = LIST.split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));
/** The header's exemptions: the indented paths after `# Exempt:` up to the next bare `#`. */
const EXEMPT = (/^# Exempt:[^\n]*\n((?:#[^\n]*\n)*?)#\n/m.exec(`${HEADER}\n`)?.[1] ?? "")
  .split("\n")
  .map((line) => /^#\s+(test\/\S+\.test\.ts)$/.exec(line)?.[1])
  .filter((path): path is string => path !== undefined);

// Built from parts so this file does not read as one that uses them.
const READS_VERSION = new RegExp(["process", "\\.versions?\\b"].join(""));
const QUOTED_TEST = ["[\"']--", "test[\"']"].join("");
/** A test file's own sign of node:test: a project, the adapter, or a `--test` argument. */
const NAMES_NODE_TEST = new RegExp(
  [
    ["\\bnode", "Test\\b"].join(""),
    ["NodeTest", "Project"].join(""),
    ["createNodeTest", "Adapter"].join(""),
    QUOTED_TEST,
  ].join("|"),
);
/** A helper's sign of running node:test itself: a project it holds, or a `--test` argument. */
const RUNS_NODE_TEST = new RegExp([["NodeTest", "Project\\s*="].join(""), QUOTED_TEST].join("|"));
const IMPORT_FROM = /from\s+["'](\.[^"']+)["']/g;

const listDir = (dir: string): Dirent[] => readdirSync(dir, { withFileTypes: true });

/**
 * `root`-relative `.ts` files under `test/`, outside the fixtures Vitest
 * excludes. It never lists `test/fixtures/`: a scheduler test removes its
 * scratch repository there at any time (014-18).
 */
function sources(root: string = ROOT, list: (dir: string) => Dirent[] = listDir): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of list(join(root, dir))) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== "test/fixtures") walk(path);
      } else if (path.endsWith(".ts")) found.push(path);
    }
  };
  walk("test");
  return found.sort();
}

/** Vitest's positional filter (5.0.3, `filterFiles`): the root-relative path contains it, any case. */
function matches(entry: string, path: string): boolean {
  return path.toLowerCase().includes(entry.toLowerCase());
}

function selected(path: string): boolean {
  return ENTRIES.some((entry) => matches(entry, path));
}

const FILES = sources();
const TEXT = new Map(FILES.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
const text = (path: string): string => TEXT.get(path) ?? "";
const readsVersion = (path: string): boolean => READS_VERSION.test(text(path));

/** The repository-relative files `path` imports by a relative specifier. */
function imports(path: string): string[] {
  return [...text(path).matchAll(IMPORT_FROM)].map((match) =>
    normalize(join(dirname(path), match[1] ?? ""))
      .split(sep)
      .join("/")
      .replace(/\.js$/, ".ts"),
  );
}

const TESTS = FILES.filter((path) => path.endsWith(".test.ts"));
const HELPERS = FILES.filter((path) => !path.endsWith(".test.ts") && readsVersion(path));

/** Helpers that run node:test themselves, and the helpers importing one, to a fixed point. */
function runnerHelpers(): Set<string> {
  const helpers = FILES.filter((path) => !path.endsWith(".test.ts"));
  const found = new Set(helpers.filter((path) => RUNS_NODE_TEST.test(text(path))));
  for (let grew = true; grew; ) {
    grew = false;
    for (const path of helpers)
      if (!found.has(path) && imports(path).some((to) => found.has(to))) {
        found.add(path);
        grew = true;
      }
  }
  return found;
}

const RUNNER_HELPERS = runnerHelpers();
/** Test files the rule takes for node:test callers: by their own text or a runner helper. */
const NODE_TEST_CALLERS = TESTS.filter(
  (path) => NAMES_NODE_TEST.test(text(path)) || imports(path).some((to) => RUNNER_HELPERS.has(to)),
);

describe("the version-sensitive list (spec 010 D4)", () => {
  it("selects every test file that reads the Node version", () => {
    expect(TESTS.filter((path) => readsVersion(path) && !selected(path))).toEqual([]);
  });

  it("selects every test file that runs node:test, unless the header exempts it", () => {
    expect(RUNNER_HELPERS.size).toBeGreaterThan(0);
    const missing = NODE_TEST_CALLERS.filter((path) => !selected(path) && !EXEMPT.includes(path));
    expect(missing).toEqual([]);
  });

  it("exempts only files the rule flags and no entry selects", () => {
    expect(EXEMPT.length).toBeGreaterThan(0);
    const stale = EXEMPT.filter((path) => !NODE_TEST_CALLERS.includes(path) || selected(path));
    expect(stale).toEqual([]);
  });

  it("has no entry that selects no test file", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    expect(ENTRIES.filter((entry) => !TESTS.some((path) => matches(entry, path)))).toEqual([]);
  });

  it("never lists test/fixtures, where a directory may go during the walk (014-18)", () => {
    const root = mkdtempSync(join(tmpdir(), "sq-014-18-"));
    try {
      const scratch = join(root, "test/fixtures/scheduler/.tmp/run/main/.git");
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "hook.ts"), "");
      writeFileSync(join(root, "test/a.test.ts"), "");
      // Another file's cleanup: the scratch repository goes right after its parent is listed.
      const list = (dir: string): Dirent[] => {
        const entries = listDir(dir);
        if (dir === dirname(scratch)) rmSync(scratch, { recursive: true });
        return entries;
      };
      expect(sources(root, list)).toEqual(["test/a.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names in its header each helper that reads the Node version and each file importing one", () => {
    expect(HELPERS.length).toBeGreaterThan(0);
    const importers = FILES.filter((path) => imports(path).some((to) => HELPERS.includes(to)));
    const named = [...HELPERS, ...importers];
    expect(named.filter((path) => !HEADER.includes(path))).toEqual([]);
  });
});
