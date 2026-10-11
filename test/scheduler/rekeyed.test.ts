import { appendFileSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import { movesSeq } from "../../src/core/scheduler/rekeyed-moves.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";
import { liveDaemon, movesOnceRefined } from "./store-wait.js";

/*
 * Lessons, defect 32 (task 001-186): `status --wait` holds for the test files
 * whose key the edits of its window moved, and not for the baseline, a
 * backlog or another window's edits. The scheduler records, in the store,
 * the earliest and the latest revision whose move of each file's key has no
 * result yet (`FileState.keyedAt`, task 001-194), and each move resolved
 * since (`recordMoves`, task 001-258).
 */

async function open(): Promise<Harness> {
  const repo = createRepo();
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
  liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
  await h.scheduler.start();
  await h.scheduler.idle();
  return h;
}

const latest = (h: Harness): RevisionNumber => h.store.revisions.latest(h.worktreeId)?.number ?? 0;
const paths = async (h: Harness, after: RevisionNumber, upTo: RevisionNumber) =>
  (await movesOnceRefined(h, upTo, { after })).map((file) => file.testFile.path).sort();
const seq = (h: Harness) => movesSeq(h.store, h.worktreeId) ?? 0;

describe("scheduler: the files an edit re-keyed (task 001-186)", () => {
  it(
    "counts no baseline file, and an edit's files once its runner part is applied",
    SLOW,
    async () => {
      const h = await open();
      const before = latest(h);
      expect(await paths(h, 0 as RevisionNumber, before)).toEqual([]);

      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      await h.batch("src/math.ts");

      expect(latest(h)).toBe(before + 1);
      expect(await paths(h, before, latest(h))).toEqual(["test/math.test.ts"]);
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

    expect(await paths(h, before, first)).toEqual(["test/math.test.ts"]);
    expect(await paths(h, first, latest(h))).toEqual(["test/plain.test.ts"]);
    expect(await movesOnceRefined(h, latest(h), { after: before })).toContainEqual({
      testFile: { project: "", path: "test/math.test.ts" },
      revision: first,
    });
  });

  it("names every file after an environment change", SLOW, async () => {
    const h = await open();
    const before = latest(h);
    appendFileSync(`${h.root}/vitest.config.ts`, "// environment change\n");
    await h.batch("vitest.config.ts");

    expect(await paths(h, before, latest(h))).toEqual(ALL_TEST_FILES);
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

      expect(latest(h)).toBe(first + 2);
      expect(await movesOnceRefined(h, first, { after: before })).toContainEqual({
        testFile: { project: "", path: "test/math.test.ts" },
        revision: first,
      });
      // A window holding only the later edit names it too.
      expect(await paths(h, (first + 1) as RevisionNumber, latest(h))).toEqual([
        "test/math.test.ts",
      ]);

      release();
      await h.scheduler.idle();
      // Every result landed: no file holds any wait.
      expect(await movesOnceRefined(h, latest(h))).toEqual([]);
    },
  );

  // Review wave 13k, S1: a wait whose answer comes after the result still names the file.
  it(
    "names a file whose move had its result since the wait's start (task 001-196)",
    SLOW,
    async () => {
      const h = await open();
      const asked = seq(h);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      await h.batch("src/math.ts");
      const edited = latest(h);
      await h.scheduler.idle();
      const math = { project: "", path: "test/math.test.ts" };

      expect(await movesOnceRefined(h, edited)).toEqual([]);
      expect(await movesOnceRefined(h, edited, { sinceSeq: asked })).toEqual([
        { testFile: math, revision: edited, resolved: true },
      ]);
      expect(await movesOnceRefined(h, latest(h), { after: edited, sinceSeq: asked })).toEqual([]);
      expect(await movesOnceRefined(h, edited, { sinceSeq: seq(h) })).toEqual([]);

      // A later move owes its result again, whatever was resolved before it.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.runner.beforeRun = () => held;
      onTestFinished(release);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // again\n");
      await h.batch("src/math.ts");
      expect(
        await movesOnceRefined(h, latest(h), { after: edited, sinceSeq: asked }),
      ).toContainEqual({
        testFile: math,
        revision: latest(h),
      });
      release();
      await h.scheduler.idle();
    },
  );
});
