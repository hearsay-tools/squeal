import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";

/*
 * Lessons, defect 3: an edit to a module ran every test file that reaches it
 * through a barrel, slow ones first, before the module's own test. Spec 001
 * D5 step 4 as amended: "checks whose last known state is `fail` [...], then
 * test files that import a changed path directly according to the runner's
 * module graph, then transitively affected files, then never-run files;
 * within a class, shortest last known duration first, so a slow integration
 * file never delays the edited module's own unit test."
 *
 * Fixture `barrel`: `test/barrel.test.ts` (5 s) imports `src/index.ts`, which
 * re-exports `src/math.ts`; `test/math.test.ts` imports `src/math.ts`. With
 * one file per tier, the first tier after the edit is the whole answer.
 */
describe("scheduler: run order after an edit behind a barrel (D5 step 4)", SLOW, () => {
  const edit = "export const add = (a: number, b: number) => a + b + 0;\n";

  it("runs the edited module's own test in the first tier", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const baseline = h.runner.runs.length;

    h.write("src/math.ts", edit);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runner.runs.slice(baseline).map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/math.test.ts"],
      ["test/barrel.test.ts"],
    ]);
  });

  it("puts a direct importer first even when no duration is known", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 1,
      policy: { baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-only" } },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.runner.runs).toEqual([]);

    h.write("src/math.ts", edit);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runner.runs.map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/math.test.ts"],
      ["test/barrel.test.ts"],
    ]);
  });

  it("without direct importers from the runner, runs the shortest last known duration first", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    // A runner that cannot tell direct importers apart: every affected file is transitive.
    const affected = h.runner.affected.bind(h.runner);
    h.runner.affected = async (paths) => {
      const { direct, transitive } = await affected(paths);
      return { direct: [], transitive: [...direct, ...transitive] };
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    const baseline = h.runner.runs.length;

    h.write("src/math.ts", edit);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runner.runs.slice(baseline).map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/math.test.ts"],
      ["test/barrel.test.ts"],
    ]);
  });

  /*
   * Review wave 4.5, S6 and probe A: on this repository every test file
   * reaches an edited module through `src/core/state/index.ts` or another
   * barrel, so the runner's `direct` class is empty and the order comes from
   * the shortest-duration rule alone. Fixture `barrel-only`: both test files
   * import only `src/index.ts`; the slow one sorts first by path.
   */
  it("with no direct importer at all, runs the shortest last known duration first", async () => {
    const repo = createRepo("barrel-only");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    const direct: string[][] = [];
    const affected = h.runner.affected.bind(h.runner);
    h.runner.affected = async (paths) => {
      const result = await affected(paths);
      direct.push(result.direct.map((f) => f.path));
      return result;
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    const baseline = h.runner.runs.length;
    expect(h.runner.runs.map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/aa-slow.test.ts"],
      ["test/zz-fast.test.ts"],
    ]);

    h.write("src/math.ts", edit);
    await h.batch("src/math.ts");
    // The cut keeps the shortest; the other is catch-up, which waits for quiet (row 011-153).
    await idleAfterQuiet(h);
    expect(direct).toEqual([[]]);
    expect(h.runner.runs.slice(baseline).map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/zz-fast.test.ts"],
      ["test/aa-slow.test.ts"],
    ]);
  });

  /*
   * Issue 31 (011 C4 as amended, task 011-17): a test file the revision added
   * runs before a long direct importer of the same edit, though its duration
   * is unknown and the importer's is 5 s.
   */
  it("runs a test file the revision added before a long direct importer", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const baseline = h.runner.runs.length;

    h.write(
      "src/index.ts",
      'export { add } from "./math.ts";\nexport { upper } from "./strings.ts";\nexport const one = 1;\n',
    );
    h.write(
      "test/added.test.ts",
      'import { expect, it } from "vitest";\nimport { one } from "../src/index.ts";\n\nit("is one", () => {\n  expect(one).toBe(1);\n});\n',
    );
    await h.batch("src/index.ts", "test/added.test.ts");
    await h.scheduler.idle();
    expect(h.runner.runs.slice(baseline).map((run) => run.files.map((f) => f.path))).toEqual([
      ["test/added.test.ts"],
      ["test/barrel.test.ts"],
    ]);
  });
});
