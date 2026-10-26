import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSummary } from "../../../src/core/code/crap/index.js";
import { codeStatusOf, coverageStatusLines } from "../../../src/core/status/code-status.js";
import type { StatusSnapshot } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.297 B3 (repair R6): a source's loaders are the test files
 * whose closure in this worktree's own key index holds it, never the main
 * store's newest closure, which another worktree may have stored. A test
 * file whose closure is not known here may load any source: each waits,
 * and status says why.
 */

const OTHER = "wt-other";

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

const fileState = (rig: CoverageRig, path: string) => readSummary(rig.store.meta, WT)?.files[path];

/** Worktree B lists `test/a.test.ts` too, and stores its own branch's closure as the newest. */
function otherBranch(rig: CoverageRig) {
  const testFile = { project: "", path: "test/a.test.ts" };
  rig.main.testFiles.put({
    testFile,
    closure: {
      testFile,
      paths: ["test/a.test.ts", "src/other.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 2,
    updatedBy: OTHER,
  });
  rig.main.testFileKeys.upsertMany([
    { worktreeId: OTHER, testFile, key: "other-branch", revision: 1, pending: null },
  ]);
}

describe("the coverage step's loaders are this worktree's own (review 0.1.297 B3)", () => {
  it("keeps a source pending while its own loader is queued, though another worktree's closure no longer names it", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "this-branch", pending: "queued" });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "run" });

    otherBranch(rig);
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "run" });
    expect(rig.states("crap")).toEqual(["cold pending -"]);

    // Its run and record come: judged from this worktree's record.
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "this-branch",
      record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1])],
    });
    otherBranch(rig);
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "judged" });
    expect(rig.states("crap")).toEqual(["cold pass 6"]);
  });

  it("reads a source another worktree's closure names, and this one's does not, as loaded by none", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n", "src/other.ts": "far 2 f1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "this-branch", pending: "queued" });
    otherBranch(rig);
    rig.step();
    expect(fileState(rig, "src/other.ts")).toMatchObject({ state: "judged" });
    expect(rig.states("uncovered")).toEqual(["cold pending -", "far fail -"]);
  });

  it("waits while the row holds another key than the index made", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [], indexKey: "next-key" });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "run" });
  });

  it("keeps every source pending while a listed test file's closure is unknown, says so, and judges once it comes", async () => {
    const rig = coverageRig();
    writeFileSync(
      join(rig.tree.root, "squeal.config.json"),
      JSON.stringify({ complexity: { enabled: true }, coverage: { enabled: true } }),
    );
    await rig.edit({ "src/a.ts": "cold 6 c1\n", "src/b.ts": "b 1 b1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.loader("test/new.test.ts", { closure: ["src/b.ts"], record: [], indexKey: null });
    rig.step();
    for (const path of ["src/a.ts", "src/b.ts"]) {
      expect(fileState(rig, path)).toMatchObject({ state: "pending", reason: "imports" });
    }
    const { code } = codeStatusOf(
      rig.main,
      WT,
      { root: rig.tree.root, commonDir: () => rig.tree.commonDir },
      null,
    );
    expect(code?.coverage).toMatchObject({ waitingForImports: { files: 2, testFiles: 1 } });
    expect(coverageStatusLines({ code } as StatusSnapshot, "squeal")).toEqual([
      "Coverage: 0 functions over CRAP 30, 0 untested; 2 files wait for the imports of 1 test file; squeal code lists them.",
    ]);

    rig.closures.set("test/new.test.ts", {
      key: "key-test/new.test.ts",
      paths: ["test/new.test.ts", "src/b.ts"],
    });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "judged" });
    expect(fileState(rig, "src/b.ts")).toMatchObject({ state: "judged" });
    expect(rig.states("crap")).toEqual(["cold fail 42", "b pass 2"]);
  });

  it("judges nothing before the scheduler holds a key index", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step({ closures: null });
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "imports" });
    expect(rig.states("crap")).toEqual(["cold pending -"]);
  });
});
