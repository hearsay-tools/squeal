import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import { type InstallCheck, InstallStamps } from "../../src/core/scheduler/install-stamp.js";
import { type FixturePackage, writeInstall } from "../keys/install.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Review 0.1.515 B1 (row 011-356): the step took an install change into the
 * reads of one iteration (`InstallStamps.takeChange`), and runner work queued
 * before the next step drained first; the reads were cleared, the next
 * check found the stamp taken, and the refresh of task 001-109 was lost.
 * The change is an obligation until its refresh is carried out.
 */

const INSTALL: Readonly<Record<string, FixturePackage>> = {
  "node_modules/kept": {
    version: "1.0.0",
    manifest: { type: "module" },
    files: { "index.js": 'export const version = "1.0.0";\n' },
  },
};

const SIDE = "test/side.test.ts";
const SIDE_TEST =
  'import { side } from "sideloaded";\nimport { expect, it } from "vitest";\n' +
  'it("loads a side-loaded package", () => {\n  expect(side).toBe(1);\n});\n';

/** A package folder added with no lockfile rewritten (001-109 S2). */
function sideload(root: string): void {
  const write = (path: string, content: string) => writeFileSync(join(root, path), content);
  mkdirSync(join(root, "node_modules/sideloaded"), { recursive: true });
  write(
    "node_modules/sideloaded/package.json",
    JSON.stringify({ name: "sideloaded", version: "1.0.0", type: "module" }),
  );
  write("node_modules/sideloaded/index.js", "export const side = 1;\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(
  "an install change survives runner work queued before its refresh (review 0.1.515 B1)",
  SLOW,
  () => {
    it("a source batch queued as the change is taken drains first; the refresh still re-keys", async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      writeFileSync(join(repo.main, SIDE), SIDE_TEST);
      writeInstall(repo.main, INSTALL);
      const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
      await h.scheduler.start();
      await h.quiet();
      const before = h.keyOf(SIDE);
      const runs = h.runsOf(SIDE).length;
      expect(before).not.toBeNull();

      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      const paths = await statCandidates(["src/math.ts"], createFsHasher(repo.main, "sha1"));
      sideload(repo.main);
      // The first change taken queues the source batch at once: its runner work is queued before
      // the step that would refresh the install.
      const take = InstallStamps.prototype.takeChange;
      let taken = 0;
      let queued: Promise<void> | null = null;
      vi.spyOn(InstallStamps.prototype, "takeChange").mockImplementation(function (
        this: InstallStamps,
        check: InstallCheck,
      ) {
        const changed = take.call(this, check);
        if (changed && taken++ === 0) queued = h.scheduler.handleBatch({ trigger: "watch", paths });
        return changed;
      });

      await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      await h.quiet();
      await queued;
      await h.quiet();

      expect([taken, queued !== null]).toEqual([1, true]);
      expect(h.keyOf(SIDE)).not.toBe(before);
      expect(h.runsOf(SIDE).length).toBeGreaterThan(runs);
    });
  },
);
