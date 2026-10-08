import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerAdapter, TestFileRef } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-134 (review wave 12d, B5; spec 001 D3 as amended): a recursive
 * `readdir` returned names from every directory below the one it named, so
 * an add or delete in an existing subdirectory re-keys the file. A shallow
 * listing still keys its own directory only.
 */
const RECURSIVE = "test/tree.test.ts";
const SHALLOW = "test/shallow.test.ts";
const POOLS = ["forks", "threads"] as const;
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;
const at = (path: string, project: string): TestFileRef => ({ project, path });

const RECURSIVE_TEST = `import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("lists tree recursively", () => {
  const names = readdirSync(join(import.meta.dirname, "..", "tree"), { recursive: true });
  expect(names.sort()).toEqual(["sub", "sub/a.txt", "sub/c.txt"]);
});
`;

const SHALLOW_TEST = `import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("lists tree", () => {
  expect(readdirSync(join(import.meta.dirname, "..", "tree"))).toEqual(["sub"]);
});
`;

/**
 * The recorder's report of a recursive listing (`ObservedInputs.recursive`),
 * owned by task 001-135: added here for the tree test while the recorder does
 * not report it yet, never over what it reports.
 */
function reportRecursive(runner: RunnerAdapter): void {
  const run = runner.run.bind(runner);
  runner.run = async (files, options) => {
    const report = await run(files, options);
    if (report.observed === undefined) return report;
    const observed = report.observed.map((o) =>
      o.testFile.path === RECURSIVE && o.recursive === undefined && o.directories.includes("tree")
        ? { ...o, recursive: ["tree"] }
        : o,
    );
    return { ...report, observed };
  };
}

const keysOf = (h: Harness, path: string) =>
  POOLS.map(
    (pool) =>
      h.store.testFileKeys
        .list(h.worktreeId)
        .find((row) => row.testFile.project === pool && row.testFile.path === path)?.key ?? null,
  );
const outcomesOf = (h: Harness, path: string) =>
  POOLS.map((pool) =>
    h.store.knownStates
      .list(h.worktreeId)
      .filter((s) => s.check.kind === "test" && s.check.project === pool)
      .filter((s) => s.check.testPath === path)
      .map((s) => `${s.outcome}/${s.validity}`)
      .join(),
  );
const ran = (h: Harness, path: string, from: number) =>
  h.runner.runs
    .slice(from)
    .flatMap((run) => run.files)
    .filter((f) => f.path === path).length;

describe("scheduler: a recursive listing (task 001-134, review wave 12d B5)", SLOW, () => {
  it("re-keys on an add or delete in an existing subdirectory; a shallow listing does not", async () => {
    const repo = createRepo("observed");
    writeFileSync(join(repo.main, RECURSIVE), RECURSIVE_TEST);
    writeFileSync(join(repo.main, SHALLOW), SHALLOW_TEST);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, OBSERVING);
    h.write("tree/sub/a.txt", "a\n");
    h.write("tree/sub/c.txt", "c\n");
    reportRecursive(h.runner);
    await h.scheduler.start();
    await h.scheduler.idle();
    for (const pool of POOLS) {
      const closure = store.testFiles.get(at(RECURSIVE, pool))?.closure.paths ?? [];
      expect(closure).toEqual(expect.arrayContaining(["tree/", "tree/sub/"]));
      const shallow = store.testFiles.get(at(SHALLOW, pool))?.closure.paths ?? [];
      expect(shallow).toContain("tree/");
      expect(shallow).not.toContain("tree/sub/");
    }
    expect(outcomesOf(h, RECURSIVE)).toEqual(["pass/current", "pass/current"]);
    const listed = keysOf(h, RECURSIVE);
    const shallow = keysOf(h, SHALLOW);

    // A nested addition: re-keyed and run, and the new name fails it.
    let from = h.runner.runs.length;
    h.write("tree/sub/b.txt", "b\n");
    await h.batch("tree/sub/b.txt");
    await h.scheduler.idle();
    const added = keysOf(h, RECURSIVE);
    for (const [i, key] of added.entries()) expect(key).not.toBe(listed[i]);
    expect(ran(h, RECURSIVE, from)).toBe(2);
    expect(outcomesOf(h, RECURSIVE)).toEqual(["fail/current", "fail/current"]);
    expect(keysOf(h, SHALLOW)).toEqual(shallow);
    expect(ran(h, SHALLOW, from)).toBe(0);

    // Its removal: back to the first key and its pass.
    h.remove("tree/sub/b.txt");
    await h.batch("tree/sub/b.txt");
    await h.scheduler.idle();
    expect(keysOf(h, RECURSIVE)).toEqual(listed);
    expect(outcomesOf(h, RECURSIVE)).toEqual(["pass/current", "pass/current"]);

    // A nested removal of a file that was there from the start.
    from = h.runner.runs.length;
    h.remove("tree/sub/c.txt");
    await h.batch("tree/sub/c.txt");
    await h.scheduler.idle();
    const removed = keysOf(h, RECURSIVE);
    for (const [i, key] of removed.entries()) {
      expect(key).not.toBe(listed[i]);
      expect(key).not.toBe(added[i]);
    }
    expect(ran(h, RECURSIVE, from)).toBe(2);
    expect(outcomesOf(h, RECURSIVE)).toEqual(["fail/current", "fail/current"]);
    expect(keysOf(h, SHALLOW)).toEqual(shallow);
  });
});
