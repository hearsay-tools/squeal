import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Spec 010 D4: Node 24 runs only the test files `test/version-sensitive.txt`
 * lists, so a file that reads the Node version must be listed, every entry
 * must still select a file, and the header names the helpers that read the
 * version and the files that import them.
 */
const ROOT = join(import.meta.dirname, "..");
const LIST = readFileSync(join(ROOT, "test/version-sensitive.txt"), "utf8");
const HEADER = LIST.split("\n")
  .filter((line) => line.startsWith("#"))
  .join("\n");
const ENTRIES = LIST.split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

// Built from parts so this file does not read as one that uses it.
const READS_VERSION = new RegExp(["process", "\\.versions?\\b"].join(""));
const IMPORT_FROM = /from\s+["'](\.[^"']+)["']/g;

/** Repository-relative `.ts` files under `test/`, outside the fixtures Vitest excludes. */
function sources(): string[] {
  return readdirSync(join(ROOT, "test"), { recursive: true, encoding: "utf8" })
    .map((path) => join("test", path).split(sep).join("/"))
    .filter((path) => path.endsWith(".ts") && !path.startsWith("test/fixtures/"))
    .sort();
}

/** Vitest's positional filter (5.0.3, `filterFiles`): the root-relative path contains it, any case. */
function matches(entry: string, path: string): boolean {
  return path.toLowerCase().includes(entry.toLowerCase());
}

function selected(path: string): boolean {
  return ENTRIES.some((entry) => matches(entry, path));
}

function readsVersion(path: string): boolean {
  return READS_VERSION.test(readFileSync(join(ROOT, path), "utf8"));
}

/** The repository-relative files `path` imports by a relative specifier. */
function imports(path: string): string[] {
  const text = readFileSync(join(ROOT, path), "utf8");
  return [...text.matchAll(IMPORT_FROM)].map((match) =>
    normalize(join(dirname(path), match[1] ?? ""))
      .split(sep)
      .join("/")
      .replace(/\.js$/, ".ts"),
  );
}

const FILES = sources();
const TESTS = FILES.filter((path) => path.endsWith(".test.ts"));
const HELPERS = FILES.filter((path) => !path.endsWith(".test.ts") && readsVersion(path));

describe("the version-sensitive list (spec 010 D4)", () => {
  it("selects every test file that reads the Node version", () => {
    expect(TESTS.filter((path) => readsVersion(path) && !selected(path))).toEqual([]);
  });

  it("has no entry that selects no test file", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    expect(ENTRIES.filter((entry) => !TESTS.some((path) => matches(entry, path)))).toEqual([]);
  });

  it("names in its header each helper that reads the Node version and each file importing one", () => {
    expect(HELPERS.length).toBeGreaterThan(0);
    const importers = FILES.filter((path) => imports(path).some((to) => HELPERS.includes(to)));
    const named = [...HELPERS, ...importers];
    expect(named.filter((path) => !HEADER.includes(path))).toEqual([]);
  });
});
