import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

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
    // A runner without `affectedDetailed`: every affected file is transitive.
    delete (h.runner as { affectedDetailed?: unknown }).affectedDetailed;
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
});
