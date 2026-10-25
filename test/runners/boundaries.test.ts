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
 * `reviews/016-12.md` B1, row 016-20).
 */

const ROOT = resolve(import.meta.dirname, "../..");
const RUNNERS = join(ROOT, "src/runners");
const CODE = /\.[cm]?[jt]s$/;
const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

/** The folders under `runners` that hold an adapter, by name. */
function runnerFolders(runners: string): string[] {
  return readdirSync(runners, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(runners, entry.name, "adapter.ts")))
    .map((entry) => entry.name)
    .sort();
}

/** Each relative import under `runners` that reaches a runner's folder other than its own file's. */
function crossings(runners: string): string[] {
  const folders = new Set(runnerFolders(runners));
  const folderOf = (path: string) => {
    const [first, ...rest] = path.split(sep);
    return first !== undefined && rest.length > 0 && folders.has(first) ? first : null;
  };
  const found: string[] = [];
  for (const path of readdirSync(runners, { recursive: true, encoding: "utf8" }).sort()) {
    if (!CODE.test(path)) continue;
    const own = folderOf(path);
    for (const [, specifier] of readFileSync(join(runners, path), "utf8").matchAll(SPECIFIER)) {
      if (!specifier?.startsWith(".")) continue;
      const target = relative(runners, resolve(runners, dirname(path), specifier));
      const reached = folderOf(target);
      if (reached !== null && reached !== own) found.push(`${path} imports ${target}`);
    }
  }
  return found;
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

  describe("the rule, on a scratch tree", () => {
    const scratch = mkdtempSync(join(tmpdir(), "squeal-runner-boundaries-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    const TREE: Record<string, string> = {
      "a/adapter.ts": 'import { x } from "../shared/x.js";\nimport { y } from "./run/y.js";\n',
      "a/run/y.ts": 'import type { B } from "../../b/adapter.js";\n',
      "a/runtime/r.cjs": 'require("../../b/runtime/r.cjs");\n',
      "b/adapter.ts": 'export * from "../top.js";\nconst a = () => import("../a/adapter.js");\n',
      "b/runtime/r.cjs": "",
      "shared/x.ts": 'import "../b/adapter.js";\nexport const x = 1;\n',
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
        `${join("shared", "x.ts")} imports ${join("b", "adapter.js")}`,
      ]);
    });
  });
});
