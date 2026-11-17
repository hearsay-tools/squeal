import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { candidates, stemOf, targetCoverage } from "../../src/core/commit/at-keys-coverage.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { NO_PARTS } from "../../src/core/store/transfer-rekey.js";
import type { PolicyInputs } from "../../src/core/types/policy.js";
import { git } from "../hash/git-repo.js";

/*
 * Review of wave 1 B1 (row 023-03): a closure list proves a key at a commit
 * only when it covers what a run there reads. One committed tree is the
 * target; `here` maps stand for this worktree's file hashes, so a path
 * "differs" where its entry is changed or left out. Each rule of
 * `targetCoverage` gets one case that leaves the list open and one that
 * does not.
 */

const T = "test/t.test.ts";
const FILES: Readonly<Record<string, string>> = {
  [T]: 'import { a } from "../src/a.js";\nimport "node:fs";\n',
  "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
  "src/b.ts": "export const b = 2;\n",
  "src/lazy.ts": "export const load = (name: string) => import(name);\n",
  "src/broken.ts": 'import "./nowhere";\n',
  "src/pkg.ts": 'import pad from "left-pad";\nexport default pad;\n',
  "src/x/index.ts": "export {};\n",
  "src/x.ts": "export {};\n",
  "data/one.txt": "one\n",
};

let root = "";
let blobs: Map<string, string> = new Map();

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-at-coverage-")));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "target"]);
  blobs = await committedBlobs(root, "HEAD");
  // This worktree's `src/pkg.ts` imports no package.
  writeFileSync(join(root, "src/pkg.ts"), "export default 1;\n");
  return () => rmSync(root, { recursive: true, force: true });
});

const ref = { project: "", path: T };
const open = { parts: NO_PARTS, observed: false };

/** The gap of `list` at the target, with `changed` paths differing here and `gone` absent here. */
async function gap(
  list: string[],
  changed: string[] = [],
  options: { gone?: string[]; inputs?: PolicyInputs; observed?: boolean; parts?: boolean } = {},
): Promise<string | null> {
  const here = new Map(blobs);
  for (const path of changed) here.set(path, "changed");
  for (const path of options.gone ?? []) here.delete(path);
  const coverage = await targetCoverage({
    root,
    blobs,
    here,
    paths: list,
    inputs: options.inputs ?? [],
  });
  return coverage(ref, list, {
    observed: options.observed ?? false,
    parts: options.parts === true ? { dependencies: "deps", runtime: "" } : open.parts,
  });
}

const LIST = [T, "src/a.ts", "src/b.ts"];

describe("targetCoverage (review of wave 1 B1)", () => {
  it("covers an unchanged list and changed files whose imports stay in it", async () => {
    expect(await gap(LIST)).toBeNull();
    expect(await gap(LIST, ["src/a.ts", T])).toBeNull();
  });

  it("leaves open a changed file that imports, at the commit, a file outside the list", async () => {
    expect(await gap([T, "src/a.ts"], ["src/a.ts"])).toBe(
      "src/a.ts imports src/b.ts at the commit, not in the list",
    );
  });

  it("leaves open a computed import and an import the commit does not hold", async () => {
    expect(await gap([T, "src/lazy.ts"], ["src/lazy.ts"])).toBe(
      "src/lazy.ts at the commit loads a module it does not name",
    );
    expect(await gap([T, "src/broken.ts"], ["src/broken.ts"])).toBe(
      "src/broken.ts imports ./nowhere, which the commit does not hold",
    );
  });

  it("takes a package only when this worktree's file imports it too", async () => {
    expect(await gap([T, "src/pkg.ts"], ["src/pkg.ts"])).toBe(
      "src/pkg.ts imports left-pad at the commit, which this worktree's file does not",
    );
    writeFileSync(join(root, "src/pkg.ts"), FILES["src/pkg.ts"] ?? "");
    try {
      expect(await gap([T, "src/pkg.ts"], ["src/pkg.ts"])).toBeNull();
    } finally {
      writeFileSync(join(root, "src/pkg.ts"), "export default 1;\n");
    }
  });

  it("leaves open a file at the commit that can take a list file's place", async () => {
    expect(await gap([T, "src/x/index.ts"], [], { gone: ["src/x.ts"] })).toBe(
      "src/x.ts at the commit can take the place of src/x/index.ts",
    );
    expect(await gap([T, "src/x/index.ts"])).toBeNull();
  });

  it("leaves open run-time reads and key parts once a list file changed", async () => {
    expect(await gap(LIST, ["src/b.ts"], { observed: true })).toBe(
      "the file reads files at run time, and src/b.ts differs at the commit",
    );
    expect(await gap(LIST, ["src/b.ts"], { parts: true })).toBe(
      "its key parts at the commit are not known: src/b.ts differs",
    );
    expect(await gap(LIST, [], { observed: true, parts: true })).toBeNull();
  });

  it("needs the commit's declared inputs in the list, and the test file at the commit", async () => {
    const inputs = ["data/*.txt"];
    expect(await gap(LIST, [], { inputs })).toBe(
      "declared input data/one.txt at the commit is not in the list",
    );
    expect(await gap([...LIST, "data/one.txt"], [], { inputs })).toBeNull();
    const coverage = await targetCoverage({ root, blobs, here: blobs, paths: [], inputs: [] });
    expect(coverage({ project: "", path: "test/gone.test.ts" }, [], open)).toBe(
      "the test file is absent at the commit",
    );
  });
});

describe("resolution candidates", () => {
  it("tries the path, a TypeScript source of a .js name, extensions and index files", () => {
    expect(candidates("test", "../src/a.js").slice(0, 3)).toEqual([
      "src/a.js",
      "src/a.ts",
      "src/a.tsx",
    ]);
    expect(candidates("src", "./x")).toContain("src/x/index.ts");
    expect(candidates("src", "./x?raw")).toContain("src/x.ts");
    expect(candidates("", "../outside")).toEqual([]);
    expect(stemOf("src/x/index.ts")).toBe(stemOf("src/x.ts"));
    expect(stemOf("data/one.txt")).toBeNull();
  });
});
