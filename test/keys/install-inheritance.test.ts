import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import {
  ALL_TEST_FILES,
  addWorktree,
  createRepo,
  openHarness,
  openRepoStore,
  SLOW,
} from "../scheduler/helpers.js";
import { type FixturePackage, writeInstall } from "./install.js";

// Task 001-105, lessons defect 20 through a real bootstrap: a second worktree whose install differs
// from the first's only in packages a test file does not load inherits that file's results, and runs
// the file whose package changed.

const esm = (source: string) => ({ manifest: { type: "module" }, files: { "index.js": source } });
const pkg = (version: string): FixturePackage => ({
  version,
  ...esm(`export const version = ${JSON.stringify(version)};\n`),
});

const FIRST: Readonly<Record<string, FixturePackage>> = {
  "node_modules/kept": pkg("1.0.0"),
  "node_modules/bumped": pkg("1.0.0"),
};
const SECOND: Readonly<Record<string, FixturePackage>> = {
  "node_modules/kept": pkg("1.0.0"),
  "node_modules/bumped": pkg("2.0.0"),
  "node_modules/unused": pkg("1.0.0"),
};

const TESTS = {
  "test/kept.test.ts":
    'import { version } from "kept";\nimport { expect, it } from "vitest";\nit("loads kept", () => {\n  expect(version).toBe("1.0.0");\n});\n',
  "test/bumped.test.ts":
    'import { version } from "bumped";\nimport { expect, it } from "vitest";\nit("loads bumped", () => {\n  expect(version).toMatch(/^\\d/);\n});\n',
};

describe("per-package keys across worktrees (001-105, defect 20)", SLOW, () => {
  for (const rows of ["kept", "cleared"] as const) {
    it(`a second worktree with another install runs only the test file whose package changed (test_files rows ${rows})`, async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      for (const [path, content] of Object.entries(TESTS)) {
        writeFileSync(join(repo.main, path), content);
      }
      git(repo.main, ["add", "-A"]);
      git(repo.main, ["commit", "-qm", "packages"]);
      writeInstall(repo.main, FIRST);
      const a = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
      await a.scheduler.start();
      await a.scheduler.idle();
      const ran = a.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort();
      expect(ran).toEqual([...ALL_TEST_FILES, ...Object.keys(TESTS)].sort());

      const root = addWorktree(repo.main, repo.dir, "second");
      writeInstall(root, SECOND);
      if (rows === "cleared")
        for (const row of store.testFiles.list()) store.testFiles.remove(row.testFile);
      const b = await openHarness(root, store, repo.commonDir, { tierSize: 10 });
      await b.scheduler.start();
      await b.scheduler.idle();

      expect(b.runner.runs.flatMap((r) => r.files.map((f) => f.path))).toEqual([
        "test/bumped.test.ts",
      ]);
      for (const path of [...ALL_TEST_FILES, "test/kept.test.ts"]) {
        expect(b.keyOf(path)).toBe(a.keyOf(path));
      }
      expect(b.keyOf("test/bumped.test.ts")).not.toBe(a.keyOf("test/bumped.test.ts"));
      // Every check but the bumped file's (its test and its file-level check) is inherited.
      expect(b.header()).toMatchObject({
        counts: { current: 15, pending: 0, stale: 0, unknown: 0 },
        inheritedCount: 13,
      });
    });
  }
});
