import { readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPartsIn } from "../../../src/core/ci/parts.js";
import { FILE_ERROR } from "../../../src/core/code/gate/evidence.js";
import { partsEvidence } from "../../../src/core/code/gate/parts.js";
import { namesHash } from "../../../src/core/keys/observed.js";
import { writeFile } from "../../hash/git-repo.js";
import { ENVIRONMENT, GATE } from "./parts-fixture.js";
import { blob, CLOSURE, EVIDENCE, file, part, REF, repos, taken, unrecorded } from "./parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b; research `ci-evidence.md` Q3, rule 3): the
 * rules `partsEvidence` takes a file by, over synthetic parts of a small
 * repository (`parts-kit.ts`); `parts-refused.test.ts` has what makes a
 * file run, and why (row 020-49). The end-to-end cases with `ci record`'s
 * real parts are in `test/cli/code-gate-parts*.test.ts`.
 */

const repo = repos();

describe("partsEvidence: a certified file (spec 020 D13.2)", () => {
  it("is taken with its record, its checks and the closure here", async () => {
    const { evidence, notes, refused } = await taken(repo(), [part()]);

    expect(refused).toEqual([]);
    expect(evidence).toEqual({
      runner: "vitest",
      path: "test/a.test.ts",
      completed: true,
      failed: [],
      skipped: false,
      loads: ["src/a.ts", "test/a.test.ts"],
      record: { v: 1, sources: part().coverage?.sources, unread: [] },
      from: "parts",
    });
    expect(notes).toEqual([]);
  });

  it("is never taken for node:test, which ci record does not run", async () => {
    const evidence = partsEvidence({
      root: repo(),
      parts: [{ file: "p.json", part: part() }],
      changed: [],
      children: false,
      environment: GATE,
    });
    expect(await evidence("node-test", [REF], CLOSURE, ENVIRONMENT)).toEqual(new Map());
  });

  it("is taken with no record when it failed, a file-level error by name", async () => {
    const failing = unrecorded("unmapped", { outcome: "fail", checks: [] });
    const { evidence } = await taken(repo(), [part([failing])]);

    expect(evidence).toMatchObject({ failed: [FILE_ERROR], record: null, from: "parts" });
  });
});

describe("partsEvidence: the inputs a part certifies (spec 020 D13.2, 016 D4)", () => {
  it("leaves out the run's own scratch, a git-ignored path below a directory it wrote", async () => {
    const observed = { paths: ["data/x.txt", "out/run.json"], directories: [], written: ["out"] };
    expect((await taken(repo(), [part([file({ observed })])])).evidence).not.toBeNull();

    // Not below a directory it wrote: an input like any other, which the evidence lacks.
    const outside = { paths: ["data/x.txt", "out/run.json"], directories: [] };
    expect((await taken(repo(), [part([file({ observed: outside })])])).evidence).toBeNull();
  });

  it("certifies a recursive listing as the listing of each directory below it", async () => {
    const root = repo();
    const names = (dir: string) => namesHash(readdirSync(join(root, dir)));
    const listings = {
      "fixtures/": names("fixtures"),
      "fixtures/one/": names("fixtures/one"),
      "fixtures/two/": names("fixtures/two"),
      "fixtures/two/deep/": names("fixtures/two/deep"),
    };
    const observed = { paths: [], directories: ["fixtures"], recursive: ["fixtures"] };
    const listed = part([file({ observed })], { evidence: { ...EVIDENCE, ...listings } });
    expect((await taken(root, [listed])).evidence).not.toBeNull();

    writeFile(root, "fixtures/two/deep/three.txt", "3\n");
    expect((await taken(root, [listed])).evidence).toBeNull();
  });

  it("certifies a path read through a directory link with its target, as the record keys it", async () => {
    const root = repo();
    symlinkSync("data", join(root, "linked"));
    const observed = { paths: ["linked/x.txt"], directories: [] };
    const through: Record<string, string> = { ...EVIDENCE, "linked/x.txt": blob("x\n") };
    expect(
      (await taken(root, [part([file({ observed })], { evidence: through })])).evidence,
    ).not.toBeNull();

    // A read of an absent file leaves no evidence of its target: the file runs.
    const { "data/x.txt": _target, ...lacking } = through;
    expect(
      (await taken(root, [part([file({ observed })], { evidence: lacking })])).evidence,
    ).toBeNull();
  });

  it("certifies the listing of a directory below that holds untracked files only, as the daemon lists files", async () => {
    const root = repo();
    writeFile(root, "fixtures/new/a.txt", "a\n");
    const names = (dir: string) => namesHash(readdirSync(join(root, dir)));
    const below = ["fixtures", "fixtures/new", "fixtures/one", "fixtures/two", "fixtures/two/deep"];
    const listings = Object.fromEntries(below.map((dir) => [`${dir}/`, names(dir)]));
    const observed = { paths: [], directories: ["fixtures"], recursive: ["fixtures"] };
    const listed = part([file({ observed })], { evidence: { ...EVIDENCE, ...listings } });
    expect((await taken(root, [listed])).evidence).not.toBeNull();

    writeFile(root, "fixtures/new/b.txt", "b\n");
    expect((await taken(root, [listed])).evidence).toBeNull();
  });
});

describe("readPartsIn (spec 020 D13.2)", () => {
  it("says why a directory gives no part", () => {
    const root = repo();
    expect(readPartsIn([join(root, "nope")])).toBe(`no directory ${join(root, "nope")}`);
    expect(readPartsIn([join(root, "src")])).toBe(
      `no part (squeal-part-*.json) in ${join(root, "src")}`,
    );
  });
});
