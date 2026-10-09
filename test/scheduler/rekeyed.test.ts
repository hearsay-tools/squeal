import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
 * backlog or another window's edits. The scheduler records the revision
 * whose change last moved each file's key (`FileState.keyedAt`).
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
    .map((file) => file.path)
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
  });

  it("names every file after an environment change", SLOW, async () => {
    const h = await open();
    const before = latest(h);
    appendFileSync(`${h.root}/vitest.config.ts`, "// environment change\n");
    await h.batch("vitest.config.ts");
    await h.scheduler.refined();

    expect(paths(h, before, latest(h))).toEqual(ALL_TEST_FILES);
  });
});
