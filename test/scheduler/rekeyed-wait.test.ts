import { describe, expect, it, onTestFinished } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { captureSync, liveDaemon } from "./store-wait.js";

/*
 * Task 001-194, from review 003-44 B1's note on 001-186: a wait whose sync
 * captured an edit's revision reads its files only once the runner part is
 * applied. A later edit that re-keyed the same file meanwhile moved its
 * `keyedAt` past the captured revision, and the wait ended quiet with no
 * files while the file had no result. Here the scheduler, store and sink
 * are real, and the files are the store's moves (task 001-258).
 */

const MATH = "test/math.test.ts";
const RESULT_AFTER_MS = 500;

describe("status --wait over a later edit of its file (task 001-194)", () => {
  it(
    "holds the captured revision's file until its result, through a later edit's re-key",
    SLOW,
    async () => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();
      liveDaemon(h.store, h.worktreeId, h.root, repo.commonDir);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.runner.beforeRun = () => held;
      onTestFinished(release);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // first\n");
      await h.batch("src/math.ts");

      let releasedAt = Number.POSITIVE_INFINITY;
      const sync = captureSync(
        () => h.scheduler.status().revision,
        async () => {
          // Edits made after the wait started land before it reads its files.
          h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 2\n");
          await h.batch("src/strings.ts");
          h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // third\n");
          await h.batch("src/math.ts");
          setTimeout(() => {
            releasedAt = performance.now();
            release();
          }, RESULT_AFTER_MS);
        },
      );

      const started = performance.now();
      const wait = await waitForStatus(h.root, { timeoutMs: 30_000, pollMs: 20, sync });
      const ended = performance.now();

      expect(wait.outcome).toBe("quiet");
      expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
      expect(ended).toBeGreaterThan(releasedAt);
      expect(ended - started).toBeGreaterThanOrEqual(RESULT_AFTER_MS);
      const math = h.store.testFileKeys
        .list(h.worktreeId)
        .find((row) => row.testFile.path === MATH);
      expect(math).toMatchObject({ key: h.keyOf(MATH), pending: null });
    },
  );
});
