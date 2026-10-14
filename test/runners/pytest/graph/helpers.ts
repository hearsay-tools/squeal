import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import type { PytestGraph } from "../../../../src/runners/pytest/graph/index.js";

export const FIXTURES = join(import.meta.dirname, "../../../fixtures/pytest");

/** A temp copy of a fixture without any environment; `cleanup` removes it. */
export function copyFixture(name: string): { root: string; cleanup: () => void } {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-pytest-graph-"));
  const root = join(scratch, name);
  cpSync(join(FIXTURES, name), root, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.venv[^/]*|__pycache__|\.pytest_cache)$/.test(src),
  });
  return { root, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

/** Every `test_*.py` under `root`, outside `.venv`, relative and sorted. */
export function testFilesOf(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".venv") || entry.name === "__pycache__") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^test_.*\.py$/.test(entry.name)) found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

/** Each test file's closure paths. */
export function closures(graph: PytestGraph, testFiles: readonly string[]): Map<string, string[]> {
  return new Map(testFiles.map((f) => [f, [...graph.closure(f).paths]]));
}

/** 001 D3's closure half of a key, as content: each path with its bytes' hash, or absent. */
export function closureHash(root: string, paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) {
    const abs = join(root, path);
    hash.update(
      `${path}\0${existsSync(abs) ? createHash("sha256").update(readFileSync(abs)).digest("hex") : "-"}\n`,
    );
  }
  return hash.digest("hex");
}

/** The test files whose closure paths differ between two snapshots. */
export function changed(before: Map<string, string[]>, after: Map<string, string[]>): string[] {
  return [...before.keys()]
    .filter((f) => before.get(f)?.join("\n") !== after.get(f)?.join("\n"))
    .sort();
}

/** The test files whose closure holds `path`. */
export function holding(snapshot: Map<string, string[]>, path: string): string[] {
  return [...snapshot]
    .filter(([, paths]) => paths.includes(path))
    .map(([f]) => f)
    .sort();
}

export const isConftest = (path: string) => basename(path) === "conftest.py";
