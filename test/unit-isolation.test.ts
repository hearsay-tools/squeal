import { spawnSync } from "node:child_process";
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config, { EXCLUDE, HOOKED, MOCKED, UNIT } from "../vitest.config.js";

/*
 * Review 0.1.629 B3: the `unit` project keeps modules from one test file to
 * the next (`isolate: false`). A helper that registers a hook when its
 * module is evaluated registers it on the first file alone, so a later
 * file's cleanups never run after its tests. These keep that from coming
 * back: no `unit` file may reach such a helper but through
 * `test/unit-cleanup.ts`, the project's setup file, and the real store
 * helper cleans up after each test in two files that share one worker.
 */

const ROOT = resolve(import.meta.dirname, "..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");
/** Inside the repository, so the nested files resolve `vitest`. Git-ignored. */
const SCRATCH = join(ROOT, "test/fixtures/scheduler/.tmp");

/** The `unit` project's setup file, evaluated before each test file: its hook is every file's. */
const HANDLED = new Set(["test/unit-cleanup.ts"]);

/** A hook call at the start of a line: run when the module is evaluated. */
const TOP_LEVEL_HOOK = /^(?:afterEach|afterAll|beforeEach|beforeAll)\(/m;

/** A relative static import, re-export or dynamic import. */
const RELATIVE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** The test files the `unit` project runs, relative to the root. */
function unitFiles(): string[] {
  const glob = (patterns: readonly string[]) => patterns.flatMap((p) => globSync(p, { cwd: ROOT }));
  const dropped = new Set(glob([...EXCLUDE, ...MOCKED, ...HOOKED]));
  return [...new Set(glob(UNIT))].filter((file) => !dropped.has(file)).sort();
}

/** The TypeScript module `specifier` names from `from`, or `null` for anything else. */
function resolveImport(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), base]) {
    if (/\.m?ts$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** What a module's text says: whether it registers a hook when evaluated, and what it imports. */
const modules = new Map<string, { readonly hook: boolean; readonly imports: readonly string[] }>();

function parsed(path: string): { readonly hook: boolean; readonly imports: readonly string[] } {
  let module = modules.get(path);
  if (module === undefined) {
    const text = readFileSync(path, "utf8");
    const imports = [...text.matchAll(RELATIVE_IMPORT)].flatMap((match) => {
      const target = resolveImport(path, match[1] ?? "");
      return target === null ? [] : [target];
    });
    module = { hook: TOP_LEVEL_HOOK.test(text), imports };
    modules.set(path, module);
  }
  return module;
}

/** Each module `file` reaches through relative imports that registers a hook when evaluated. */
function hookHelpers(file: string): string[] {
  const start = resolve(ROOT, file);
  const seen = new Set<string>();
  const found: string[] = [];
  const stack = [start];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const { hook, imports } = parsed(next);
    const rel = relative(ROOT, next);
    if (next !== start && !HANDLED.has(rel) && hook) found.push(rel);
    stack.push(...imports);
  }
  return found.sort();
}

describe("the unit project shares modules safely across files (review 0.1.629 B3)", () => {
  it("runs no file that reaches a helper whose hooks only its first importer gets", () => {
    const files = unitFiles();
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("test/store/concurrency.test.ts");
    const unit = config.test?.projects?.find(
      (project) =>
        typeof project === "object" && "test" in project && project.test?.name === "unit",
    );
    expect(unit).toMatchObject({ test: { setupFiles: [...HANDLED] } });
    const offenders = files.flatMap((file) =>
      hookHelpers(file).map((helper) => `${file} -> ${helper}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds a helper's top-level hook through a re-export, and none in a handled one", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-unit-hooks-")));
    try {
      writeFileSync(
        join(dir, "hook.ts"),
        'import { afterEach } from "vitest";\nafterEach(() => {});\n',
      );
      writeFileSync(join(dir, "nested.ts"), "export function f() {\n  afterEach(() => {});\n}\n");
      writeFileSync(join(dir, "via.ts"), 'export * from "./hook.js";\nimport "./nested.js";\n');
      writeFileSync(join(dir, "a.test.ts"), 'import "./via.js";\n');
      const found = hookHelpers(relative(ROOT, join(dir, "a.test.ts")));
      expect(found).toEqual([relative(ROOT, join(dir, "hook.ts"))]);
      expect(hookHelpers("test/store/helpers.ts")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up the store helper's temporary directories in both files of one worker", () => {
    mkdirSync(SCRATCH, { recursive: true });
    const scratch = mkdtempSync(join(SCRATCH, "unit-cleanup-"));
    try {
      const dirs = join(scratch, "dirs");
      mkdirSync(dirs);
      const helpers = join(ROOT, "test/store/helpers.ts");
      const body = (name: string) =>
        [
          'import { existsSync, writeFileSync } from "node:fs";',
          'import { join } from "node:path";',
          'import { afterAll, expect, it } from "vitest";',
          `import { tempDir } from ${JSON.stringify(helpers)};`,
          "let dir = '';",
          `it("${name} takes a directory", () => {`,
          "  dir = tempDir();",
          `  writeFileSync(join(${JSON.stringify(dirs)}, "${name}"), dir);`,
          "});",
          "afterAll(() => {",
          `  expect(existsSync(dir), "${name}'s tempDir outlived its test").toBe(false);`,
          "});",
          "",
        ].join("\n");
      writeFileSync(join(scratch, "a.test.ts"), body("a"));
      writeFileSync(join(scratch, "b.test.ts"), body("b"));
      const test = {
        include: [`${relative(ROOT, scratch)}/*.test.ts`],
        isolate: false,
        maxWorkers: 1,
        fileParallelism: false,
        setupFiles: [join(ROOT, "test/unit-cleanup.ts")],
        sequence: { shuffle: false },
      };
      const config = join(scratch, "vitest.config.mjs");
      writeFileSync(config, `export default ${JSON.stringify({ test })};\n`);
      const run = spawnSync(process.execPath, [VITEST, "run", "--root", ROOT, "--config", config], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
      });
      const taken = ["a", "b"].map((name) => readFileSync(join(dirs, name), "utf8"));
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toMatch(/Test Files\s+2 passed \(2\)/);
      // Both files took a directory of their own, and neither is left.
      expect(new Set(taken).size).toBe(2);
      expect(taken.filter((dir) => existsSync(dir))).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 150_000);
});
