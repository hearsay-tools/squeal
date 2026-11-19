import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { namedSnapshot } from "../../src/cli/wait/snapshot.js";
import type { AbsolutePath, EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { HARNESS_INCARNATION, liveDaemon } from "./store-wait.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Review 0.1.567 B1 (row 011-398): a named current test file gives its
 * verdict before the runner lists the revision only when the listing cannot
 * change its closure. Here `test/math.test.ts` imports `add` from the
 * extensionless `../src/choice`, which `src/choice/index.ts` answers. An
 * added `src/choice.ts` takes that import over; the content pass keeps the
 * test's key, and only the runner part, held here at `invalidate`, finds the
 * new closure, whose `add` fails. Before it, a wait and a snapshot on the
 * test exit 3 with the listing named; after it, the test fails. An unrelated
 * content edit, as before 011-398's review, still leaves the pass current.
 */
const MATH = "test/math.test.ts";

const sync = (revision: () => number) => (): DaemonSync => {
  const at = revision() as RevisionNumber;
  return {
    current: () => ({ state: "synced", revision: at, incarnation: HARNESS_INCARNATION }),
    stop: () => {},
  };
};

describe(
  "a named wait during a listing that may change the file's closure (review 0.1.567 B1)",
  SLOW,
  () => {
    it("keeps the listing hold for an added path that import resolution takes, not for an unrelated edit", async () => {
      const repo = createRepo("barrel");
      writeFileSync(
        join(repo.main, MATH),
        'import { expect, it } from "vitest";\nimport { add } from "../src/choice";\n\nit("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\n',
      );
      mkdirSync(join(repo.main, "src/choice"));
      writeFileSync(
        join(repo.main, "src/choice/index.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
      );
      const store = openRepoStore(repo.commonDir);
      const h = await openHarness(repo.main, store, repo.commonDir, {
        tierSize: 1,
        policy: RUN_MISSING,
      });
      await h.scheduler.start();
      await h.quiet();
      liveDaemon(store, h.worktreeId, repo.main, repo.commonDir);
      const adds = () =>
        store.knownStates
          .list(h.worktreeId)
          .find((s) => s.check.kind === "test" && s.check.testPath === MATH);
      expect(adds()).toMatchObject({ outcome: "pass", validity: "current" });
      const key = h.keyOf(MATH);

      // Every runner part waits here until released.
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const invalidate = h.runner.invalidate;
      h.runner.invalidate = async (paths) => {
        await held;
        return invalidate(paths);
      };
      const latest = () => store.revisions.latest(h.worktreeId)?.number ?? 0;
      const now = () => Date.now() as EpochMs;
      const reads = async () => {
        const root = repo.main as AbsolutePath;
        const snapshot = await namedSnapshot(root, [MATH], {
          now,
          settleMs: 0,
          sync: sync(latest),
        });
        const wait = await waitForNamed(root, [MATH], {
          timeoutMs: 300,
          pollMs: 20,
          settleMs: 0,
          now,
          sync: sync(latest),
          ask: async () => [],
          promote: () => {},
        });
        if (snapshot.outcome === "unavailable" || wait.outcome === "unavailable") {
          throw new Error("unavailable");
        }
        return [namedCode(snapshot), namedCode(wait)];
      };

      try {
        // An unrelated content edit: the listing cannot change the test's closure.
        h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase();\n// 1\n");
        await h.batch("src/strings.ts");
        await expect.poll(() => h.header().runnerPartPending, { timeout: 30_000 }).toBe(true);
        expect(await reads()).toEqual([0, 0]);

        // The added path the test's extensionless import now resolves to.
        h.write("src/wrong.ts", "export const wrong = 1;\n");
        h.write(
          "src/choice.ts",
          'import { wrong } from "./wrong.ts";\nexport const add = (a: number, b: number) => a + b + wrong;\n',
        );
        await h.batch("src/choice.ts", "src/wrong.ts");
        const added = latest();
        await expect.poll(() => h.header().revision, { timeout: 30_000 }).toBe(added);
        expect(h.header().runnerPartPending).toBe(true);
        expect(h.keyOf(MATH)).toBe(key);
        expect(adds()).toMatchObject({ outcome: "pass", validity: "current" });
        expect(await reads()).toEqual([3, 3]);
      } finally {
        release();
      }

      // The runner part finds the new closure; the test fails at its new key.
      await h.quiet();
      expect(h.keyOf(MATH)).not.toBe(key);
      expect(adds()).toMatchObject({ outcome: "fail", validity: "current" });
    });
  },
);
