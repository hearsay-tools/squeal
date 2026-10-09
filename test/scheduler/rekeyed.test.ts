import { appendFileSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import type { RevisionNumber } from "../../src/core/types/index.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Lessons, defect 32 (task 001-186): `status --wait` holds for the test files
 * whose key the edits of its window moved, and not for the baseline, a
 * backlog or another window's edits. The scheduler records the earliest
 * revision whose move of each file's key has no result yet
 * (`FileState.keyedAt`, task 001-194).
 */

async function open(): Promise<Harness> {
  const repo = createRepo();
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
  await h.scheduler.start();
  await h.scheduler.idle();
  return h;
}

const latest = (h: Harness): RevisionNumber => h.store.revisions.latest(h.worktreeId)?.number ?? 0;
const paths = (h: Harness, after: RevisionNumber, upTo: RevisionNumber) =>
  h.scheduler
    .rekeyedSince(after, upTo)
    .map((file) => file.testFile.path)
    .sort();

describe("scheduler: the files an edit re-keyed (task 001-186)", () => {
  it(
    "counts no baseline file, and an edit's files once its runner part is applied",
    SLOW,
    async () => {
      const h = await open();
      const before = latest(h);
      expect(paths(h, 0 as RevisionNumber, before)).toEqual([]);

      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      await h.batch("src/math.ts");
      await h.scheduler.refined();

      expect(latest(h)).toBe(before + 1);
      expect(paths(h, before, latest(h))).toEqual(["test/math.test.ts"]);
    },
  );

  it("names only the revisions of its window", SLOW, async () => {
    const h = await open();
    const before = latest(h);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
    const first = latest(h);
    h.write("test/plain.test.ts", 'import { it } from "vitest";\nit("is plain", () => {});\n');
    await h.batch("test/plain.test.ts");
    await h.scheduler.refined();

    expect(paths(h, before, first)).toEqual(["test/math.test.ts"]);
    expect(paths(h, first, latest(h))).toEqual(["test/plain.test.ts"]);
    expect(h.scheduler.rekeyedSince(before, latest(h))).toContainEqual({
      testFile: { project: "", path: "test/math.test.ts" },
      revision: first,
    });
  });

  it("names every file after an environment change", SLOW, async () => {
    const h = await open();
    const before = latest(h);
    appendFileSync(`${h.root}/vitest.config.ts`, "// environment change\n");
    await h.batch("vitest.config.ts");
    await h.scheduler.refined();

    expect(paths(h, before, latest(h))).toEqual(ALL_TEST_FILES);
  });

  it(
    "keeps an earlier edit's file while a later edit re-keys it, until its result (task 001-194)",
    SLOW,
    async () => {
      const h = await open();
      const before = latest(h);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.runner.beforeRun = () => held;
      onTestFinished(release);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // first\n");
      await h.batch("src/math.ts");
      const first = latest(h);
      // A wait that captured `first` asks for its files only after these land.
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // other\n");
      await h.batch("src/strings.ts");
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // third\n");
      await h.batch("src/math.ts");
      await h.scheduler.refined();

      expect(latest(h)).toBe(first + 2);
      expect(h.scheduler.rekeyedSince(before, first)).toContainEqual({
        testFile: { project: "", path: "test/math.test.ts" },
        revision: first,
      });
      // A window holding only the later edit names it too.
      expect(paths(h, (first + 1) as RevisionNumber, latest(h))).toEqual(["test/math.test.ts"]);

      release();
      await h.scheduler.idle();
      // Every result landed: no file holds any wait.
      expect(h.scheduler.rekeyedSince(0 as RevisionNumber, latest(h))).toEqual([]);
    },
  );

  // Review wave 13k, S1: a wait whose answer comes after the result still names the file.
  it(
    "names a file whose move had its result since the time asked (task 001-196)",
    SLOW,
    async () => {
      const h = await open();
      const asked = Date.now();
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      await h.batch("src/math.ts");
      const edited = latest(h);
      await h.scheduler.idle();
      const math = { project: "", path: "test/math.test.ts" };

      expect(h.scheduler.rekeyedSince(0 as RevisionNumber, edited)).toEqual([]);
      expect(h.scheduler.rekeyedSince(0 as RevisionNumber, edited, asked)).toEqual([
        { testFile: math, revision: edited, resolved: true },
      ]);
      expect(h.scheduler.rekeyedSince(edited, latest(h), asked)).toEqual([]);
      expect(h.scheduler.rekeyedSince(0 as RevisionNumber, edited, Date.now() + 1)).toEqual([]);

      // A later move owes its result again, whatever was resolved before it.
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // again\n");
      await h.batch("src/math.ts");
      await h.scheduler.refined();
      expect(h.scheduler.rekeyedSince(edited, latest(h), asked)).toContainEqual({
        testFile: math,
        revision: latest(h),
      });
    },
  );
});
