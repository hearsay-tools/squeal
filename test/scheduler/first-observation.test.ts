import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../src/core/types/index.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Task 001-134 (review wave 12d, B1; spec 001 D3, D5 as amended): a path a
 * run observed for the first time has no pre-run evidence, so the run's
 * result is never stored under the key that includes it. The file re-runs
 * under that key, and a second worktree inherits only that run's result.
 */
const APPEAR = "test/appear.test.ts";
const POOLS = ["forks", "threads"] as const;
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;
const at = (path: string, project: string): TestFileRef => ({ project, path });

/** Reads `read` before it exists; the driver creates `data/appeared.txt` while the run sleeps. */
const appearTest = (read: string) => `import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

test("${read} is absent", async () => {
  const absent = !existsSync(join(root, "${read}"));
  writeFileSync(join(root, "ready.txt"), "ready");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(absent).toBe(true);
});
`;

/** Each run reads a path no run read before, and never holds still (task 001-134). */
const NEW_PATH_TEST = `import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("reads a new path every run", () => {
  expect(existsSync(join(import.meta.dirname, "..", \`data/new-\${Date.now()}.txt\`))).toBe(false);
});
`;

const keyOf = (h: Harness, ref: TestFileRef) =>
  h.store.testFileKeys
    .list(h.worktreeId)
    .find((row) => row.testFile.project === ref.project && row.testFile.path === ref.path)?.key ??
  null;
const statesOf = (h: Harness, ref: TestFileRef) =>
  h.store.knownStates
    .list(h.worktreeId)
    .filter((s) => s.check.kind === "test")
    .filter((s) => s.check.project === ref.project && s.check.testPath === ref.path)
    .map((s) => `${s.outcome}/${s.validity}`);
/** The outcome of each run of `ref`'s test, in run order. */
const runOutcomes = (h: Harness, ref: TestFileRef) =>
  h.runner.runs.flatMap((run) =>
    run.report.results
      .filter((r) => r.check.kind === "test" && r.check.project === ref.project)
      .filter((r) => r.check.testPath === ref.path)
      .map((r) => r.outcome),
  );

/** Creates `data/appeared.txt` once a run of the appear test has looked for it; `then` may report it. */
function appearWhenReady(root: string, then: () => Promise<void>): () => void {
  const timer = setInterval(() => {
    if (!existsSync(join(root, "ready.txt"))) return;
    clearInterval(timer);
    writeFileSync(join(root, "data/appeared.txt"), "appeared\n");
    void then();
  }, 10);
  return () => clearInterval(timer);
}

/** The cases of review wave 12d B1: plain, read behind a directory link nothing cached, reported mid-run. */
const CASES = [
  { name: "unreported", read: "data/appeared.txt", link: false, watched: false },
  {
    name: "read through a directory link",
    read: "linked/appeared.txt",
    link: true,
    watched: false,
  },
  {
    name: "reported by a watch batch during the run",
    read: "data/appeared.txt",
    link: false,
    watched: true,
  },
] as const;

function plant(root: string, read: string, link: boolean): void {
  writeFileSync(join(root, APPEAR), appearTest(read));
  if (link) symlinkSync("data", join(root, "linked"));
}

describe(
  "scheduler: a path first observed during a run (task 001-134, review wave 12d B1)",
  SLOW,
  () => {
    it.each(CASES)(
      "$name: never stores the run's pass under the key with the present file, and a second worktree inherits only the re-run",
      async ({ read, link, watched }) => {
        const repo = createRepo("observed");
        const store = openRepoStore(repo.commonDir);
        const h = await openHarness(repo.main, store, repo.commonDir, OBSERVING);
        await h.scheduler.start();
        await h.scheduler.idle();
        // An edit's tier, which a watch batch during it does not cancel, as a backlog tier's is.
        const stop = appearWhenReady(repo.main, () =>
          watched ? h.batch("data/appeared.txt") : Promise.resolve(),
        );
        try {
          plant(repo.main, read, link);
          await h.batch(APPEAR, ...(link ? ["linked"] : []));
          await h.scheduler.idle();
        } finally {
          stop();
        }
        expect(existsSync(join(repo.main, "data/appeared.txt"))).toBe(true);
        const keys: string[] = [];
        let probed = 0;
        for (const pool of POOLS) {
          const ref = at(APPEAR, pool);
          expect(store.testFiles.get(ref)?.closure.paths).toContain(read);
          const key = keyOf(h, ref);
          expect(key).not.toBeNull();
          keys.push(key ?? "");
          const stored = store.results
            .byKey(key ?? "")
            .filter((r) => r.check.kind === "test" && r.check.project === pool)
            .map((r) => r.outcome);
          expect(stored).toEqual(["fail"]);
          expect(statesOf(h, ref)).toEqual(["fail/current"]);
          // A run that looked before the file appeared passed, and re-ran under the key with it.
          // A run in the same tier that looked after re-ran too: nothing from before its run held the path.
          const outcomes = runOutcomes(h, ref);
          if (outcomes[0] === "pass") probed += 1;
          expect(outcomes.length).toBeLessThanOrEqual(2);
          expect(outcomes.at(-1)).toBe("fail");
        }
        expect(probed).toBeGreaterThan(0);

        const root = addWorktree(repo.main, repo.dir, "second");
        plant(root, read, link);
        writeFileSync(join(root, "data/appeared.txt"), "appeared\n");
        const second = await openHarness(root, store, repo.commonDir, OBSERVING);
        await second.scheduler.start();
        await second.scheduler.idle();
        for (const [i, pool] of POOLS.entries()) {
          const ref = at(APPEAR, pool);
          expect(keyOf(second, ref)).toBe(keys[i]);
          expect(runOutcomes(second, ref)).toEqual([]);
          expect(statesOf(second, ref)).toEqual(["fail/current"]);
        }
      },
    );

    it("re-runs a file that reads a new path every run at most three times, then holds it unknown", async () => {
      const repo = createRepo("observed");
      writeFileSync(join(repo.main, "test/new-path.test.ts"), NEW_PATH_TEST);
      const store = openRepoStore(repo.commonDir);
      const h = await openHarness(repo.main, store, repo.commonDir, OBSERVING);
      await h.scheduler.start();
      await h.scheduler.idle();
      for (const pool of POOLS) {
        const ref = at("test/new-path.test.ts", pool);
        expect(runOutcomes(h, ref)).toEqual(["pass", "pass", "pass"]);
        expect(store.results.byKey(keyOf(h, ref) ?? "")).toEqual([]);
      }
      expect(h.header().testFilesWithoutChecks).toMatchObject({ pending: 0, unknown: 2 });
    });
  },
);
