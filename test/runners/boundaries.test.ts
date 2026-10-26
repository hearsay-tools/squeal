import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Spec 016 goal 8: an edit inside one runner's folder re-runs no other
 * runner's kit file. A kit file keys its closure, so no file under one
 * runner's folder imports another runner's folder, and no shared file under
 * `src/runners/` imports a runner's folder, which would carry that folder
 * into the closure of every runner that loads the shared file (review
 * `reviews/016-12.md` B1, row 016-20). One file is exempt: the registry
 * `descriptions.ts` (spec 016 D5) imports each runner's `describe.ts` and
 * nothing else of a runner's; no adapter imports the registry. The code
 * counter under `src/core/code/` imports no runner's folder either, so an
 * edit in a runner re-runs no complexity test (row 016-36).
 */

const ROOT = resolve(import.meta.dirname, "../..");
const RUNNERS = join(ROOT, "src/runners");
const CODE = /\.[cm]?[jt]s$/;
const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
const REGISTRY = "descriptions.ts";

/** The folders under `runners` that hold an adapter, by name. */
function runnerFolders(runners: string): string[] {
  return readdirSync(runners, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(runners, entry.name, "adapter.ts")))
    .map((entry) => entry.name)
    .sort();
}

/** The runner's folder under `runners` that holds the absolute `path`, or null. */
function runnerFolderOf(runners: string): (path: string) => string | null {
  const folders = new Set(runnerFolders(runners));
  return (path) => {
    const [first, ...rest] = relative(runners, path).split(sep);
    return first !== undefined && rest.length > 0 && folders.has(first) ? first : null;
  };
}

/** Each relative import of a code file under `dir`: the file, `dir`-relative, and the absolute path it reaches. */
function* relativeImports(dir: string): Generator<{ path: string; target: string }> {
  for (const path of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    if (!CODE.test(path)) continue;
    for (const [, specifier] of readFileSync(join(dir, path), "utf8").matchAll(SPECIFIER)) {
      if (specifier?.startsWith("."))
        yield { path, target: resolve(dir, dirname(path), specifier) };
    }
  }
}

/** Each relative import under `runners` that reaches a runner's folder other than its own file's. */
function crossings(runners: string): string[] {
  const folderOf = runnerFolderOf(runners);
  const found: string[] = [];
  for (const { path, target } of relativeImports(runners)) {
    const reached = folderOf(target);
    const described =
      path === REGISTRY && relative(runners, target) === join(reached ?? "", "describe.js");
    if (reached !== null && reached !== folderOf(join(runners, path)) && !described)
      found.push(`${path} imports ${relative(runners, target)}`);
  }
  return found;
}

/** Each relative import of a code file under `dir`, outside `runners`, that reaches a runner's folder. */
function runnerImports(dir: string, runners: string): string[] {
  const folderOf = runnerFolderOf(runners);
  return [...relativeImports(dir)]
    .filter(({ target }) => folderOf(target) !== null)
    .map(({ path, target }) => `${path} imports ${relative(runners, target)}`);
}

describe("runner folders (spec 016 goal 8)", () => {
  it("are the kit's runners, one folder with an adapter each", () => {
    const packs = readdirSync(join(ROOT, "test/kit/packs")).map((name) =>
      name.replace(/\.ts$/, ""),
    );
    expect(runnerFolders(RUNNERS)).toEqual(packs.sort());
  });

  it("import no other runner's folder, and no shared file under src/runners imports one", () => {
    expect(crossings(RUNNERS)).toEqual([]);
  });

  it("are imported by no file of the code counter under src/core/code (row 016-36)", () => {
    expect(runnerImports(join(ROOT, "src/core/code"), RUNNERS)).toEqual([]);
  });

  describe("the rule, on a scratch tree", () => {
    const scratch = mkdtempSync(join(tmpdir(), "squeal-runner-boundaries-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    const TREE: Record<string, string> = {
      "a/adapter.ts": 'import { x } from "../shared/x.js";\nimport { y } from "./run/y.js";\n',
      "a/run/y.ts": 'import type { B } from "../../b/adapter.js";\n',
      "a/runtime/r.cjs": 'require("../../b/runtime/r.cjs");\n',
      "b/adapter.ts": 'export * from "../top.js";\nconst a = () => import("../a/adapter.js");\n',
      "b/describe.ts": "export const b = 1;\n",
      "b/runtime/r.cjs": "",
      "descriptions.ts": 'import { b } from "./b/describe.js";\nimport "./a/adapter.js";\n',
      "shared/x.ts": 'import "../b/adapter.js";\nexport const x = 1;\n',
      "shared/z.ts": 'import "./x.js";\nimport "../top.js";\nimport "../b/describe.js";\n',
      "top.ts": "export const top = 1;\n",
    };
    beforeAll(() => {
      for (const [path, text] of Object.entries(TREE)) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        writeFileSync(join(scratch, path), text);
      }
    });

    it("reads a runner's folder as one that holds an adapter", () => {
      expect(runnerFolders(scratch)).toEqual(["a", "b"]);
    });

    it("finds each import that crosses into another runner's folder, and only those", () => {
      expect(crossings(scratch)).toEqual([
        `${join("a", "run", "y.ts")} imports ${join("b", "adapter.js")}`,
        `${join("a", "runtime", "r.cjs")} imports ${join("b", "runtime", "r.cjs")}`,
        `${join("b", "adapter.ts")} imports ${join("a", "adapter.js")}`,
        `descriptions.ts imports ${join("a", "adapter.js")}`,
        `${join("shared", "x.ts")} imports ${join("b", "adapter.js")}`,
        `${join("shared", "z.ts")} imports ${join("b", "describe.js")}`,
      ]);
    });

    it("finds each import from a folder outside the runners that reaches a runner's folder", () => {
      expect(runnerImports(join(scratch, "shared"), scratch)).toEqual([
        `x.ts imports ${join("b", "adapter.js")}`,
        `z.ts imports ${join("b", "describe.js")}`,
      ]);
    });
  });
});
