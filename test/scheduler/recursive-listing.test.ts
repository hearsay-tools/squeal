import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-134 (review wave 12d, B5; spec 001 D3 as amended): a recursive
 * `readdir` returned names from every directory below the one it named, so
 * an add or delete in an existing subdirectory re-keys the file. A shallow
 * listing still keys its own directory only. Task 001-139 (review wave 12e,
 * B5): the real recorder reports the recursive listing, for the sync,
 * callback and promise forms alike; nothing here supplies it.
 */
const FORMS = {
  "test/sync.test.ts": `const names = readdirSync(tree, { recursive: true });`,
  "test/callback.test.ts": `const names = await new Promise((resolve, reject) =>
    readdir(tree, { recursive: true }, (error, found) => (error ? reject(error) : resolve(found))),
  );`,
  "test/promise.test.ts": `const names = await promises.readdir(tree, { recursive: true });`,
};
const RECURSIVE = Object.keys(FORMS);
const SHALLOW = "test/shallow.test.ts";
const POOLS = ["forks", "threads"] as const;
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;
const at = (path: string, project: string): TestFileRef => ({ project, path });

const recursiveTest = (call: string) => `import { promises, readdir, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("lists tree recursively", async () => {
  const tree = join(import.meta.dirname, "..", "tree");
  ${call}
  expect(names.sort()).toEqual(["sub", "sub/a.txt"]);
});
`;

const SHALLOW_TEST = `import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("lists tree", () => {
  expect(readdirSync(join(import.meta.dirname, "..", "tree"))).toEqual(["sub"]);
});
`;

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

describe("scheduler: a recursive listing (tasks 001-134, 001-139; review wave 12e B5)", SLOW, () => {
  it("re-keys on an add or delete in an existing subdirectory; a shallow listing does not", async () => {
    const repo = createRepo("observed");
    for (const [path, call] of Object.entries(FORMS)) {
      writeFileSync(join(repo.main, path), recursiveTest(call));
    }
    writeFileSync(join(repo.main, SHALLOW), SHALLOW_TEST);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, OBSERVING);
    h.write("tree/sub/a.txt", "a\n");
    await h.scheduler.start();
    await h.scheduler.idle();
    const keys = (paths: string[]) => paths.map((path) => keysOf(h, path));
    const outcomes = (paths: string[]) => paths.map((path) => outcomesOf(h, path));
    const runs = (from: number) => RECURSIVE.map((path) => ran(h, path, from));
    const each = <T>(value: T) => RECURSIVE.map(() => value);
    for (const pool of POOLS) {
      for (const path of RECURSIVE) {
        const closure = store.testFiles.get(at(path, pool))?.closure.paths ?? [];
        expect(closure, `${path} ${pool}`).toEqual(expect.arrayContaining(["tree/", "tree/sub/"]));
      }
      const shallow = store.testFiles.get(at(SHALLOW, pool))?.closure.paths ?? [];
      expect(shallow).toContain("tree/");
      expect(shallow).not.toContain("tree/sub/");
    }
    expect(outcomes(RECURSIVE)).toEqual(each(["pass/current", "pass/current"]));
    const listed = keys(RECURSIVE);
    const shallow = keysOf(h, SHALLOW);

    // A nested addition: re-keyed and run, and the new name fails it.
    let from = h.runner.runs.length;
    h.write("tree/sub/b.txt", "b\n");
    await h.batch("tree/sub/b.txt");
    await h.scheduler.idle();
    const added = keys(RECURSIVE);
    for (const [f, file] of added.entries()) {
      for (const [p, key] of file.entries()) expect(key).not.toBe(listed[f]?.[p]);
    }
    expect(runs(from)).toEqual(each(2));
    expect(outcomes(RECURSIVE)).toEqual(each(["fail/current", "fail/current"]));
    expect(keysOf(h, SHALLOW)).toEqual(shallow);
    expect(ran(h, SHALLOW, from)).toBe(0);

    // A nested removal of the file that was there from the start.
    from = h.runner.runs.length;
    h.remove("tree/sub/a.txt");
    await h.batch("tree/sub/a.txt");
    await h.scheduler.idle();
    const removed = keys(RECURSIVE);
    for (const [f, file] of removed.entries()) {
      for (const [p, key] of file.entries()) {
        expect(key).not.toBe(listed[f]?.[p]);
        expect(key).not.toBe(added[f]?.[p]);
      }
    }
    expect(runs(from)).toEqual(each(2));
    expect(outcomes(RECURSIVE)).toEqual(each(["fail/current", "fail/current"]));
    expect(keysOf(h, SHALLOW)).toEqual(shallow);
    expect(ran(h, SHALLOW, from)).toBe(0);
  });
});
