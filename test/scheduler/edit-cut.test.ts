import { describe, expect, it } from "vitest";
import { notesMetaKey } from "../../src/core/types/index.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import {
  editAndRun,
  expectCut,
  expectEditsFirst,
  FOUR_SHORT,
  importers,
  pathsOf,
  SIX,
  started,
  transitive,
} from "./edit-cut-fixture.js";

/*
 * Task 011-25 (spec 011 C4 step 4 as amended 2026-10-20, the human's cut
 * (n+K); `research/edit-cut.md` done-when 1, 3, 4, 7): a revision of fewer
 * than 10 keyed paths keeps as an edit's work its edited test files, each
 * changed source's namesakes among the files it re-keyed (or, with none,
 * the source's direct importers) and the `runner.tierSize` shortest other
 * direct importers; the rest of its reach is catch-up. On cezar an edit of
 * `runs/store.ts` held 150 direct importers as edit tiers, and the next
 * edit waited 132 s at p90.
 */
const A = "src/a.ts";
const C = "src/c.ts";
// The own test is slower than the four shortest others: only the namesake rule keeps it.
const OWN: CatchUpFile = { path: "src/a.test.ts", ms: 900, imports: [A] };
const OTHERS = importers("d", A, FOUR_SHORT);
const BARE = importers("c", C, SIX);
/**
 * Task 011-116: with every direct importer kept, the `runner.tierSize` places
 * go to the files that reach the source through another module, shortest first.
 */
const shortest4 = (files: readonly CatchUpFile[]) =>
  [...files].sort((a, b) => a.ms - b.ms || a.path.localeCompare(b.path)).slice(0, 4);

describe("scheduler: an edit keeps its namesakes and the shortest direct importers (C4 step 4, task 011-25)", {
  timeout: 120_000,
}, () => {
  it("1. runs a.test.ts and the 4 shortest other direct importers as edit tiers, the rest as catch-up", async () => {
    const far = transitive("t", A, 201);
    const files = [OWN, ...OTHERS, ...far];
    const { side } = await started(files);
    const result = await editAndRun(side, A);
    expectCut(result, [OWN, ...OTHERS.slice(0, 4)], OTHERS.slice(4));
    expect(result.edits).toHaveLength(2);
    expectEditsFirst(result);
    expect(files.every((f) => side.current(f.path))).toBe(true);
  });

  it("3. keeps every direct importer of a source with no namesake and the 4 shortest transitive files, and makes the rest catch-up", async () => {
    // `src/c.test.ts` is c's namesake by name, but does not reach it: the revision does not re-key it.
    const unrelated: CatchUpFile = { path: "src/c.test.ts", ms: 100, imports: ["src/other.ts"] };
    const far = transitive("t", C, 60);
    const { side } = await started([unrelated, ...BARE, ...far]);
    const result = await editAndRun(side, C);
    // Task 011-116: the 4 shortest transitive files are an edit's work too, no longer catch-up.
    expectCut(result, [...BARE, ...shortest4(far)], far.slice(-1));
    expect(result.editPaths).not.toContain(unrelated.path);
    expect(result.catchUpPaths).not.toContain(unrelated.path);
    expectEditsFirst(result);
  });

  it.each([
    ["two e.test.ts in other directories", "src/e.ts", ["test/a/e.test.ts", "test/b/e.test.ts"]],
    ["an index file's index.test.ts", "src/index.ts", ["src/index.test.ts"]],
  ])("3. finds no namesake for %s, so keeps all six direct importers", async (_, source, named) => {
    const own = named.map((path) => ({ path, ms: 800, imports: [source] }));
    const direct = [...importers("x", source, SIX.slice(0, 6 - own.length)), ...own];
    const far = transitive("t", source, 30);
    const { side } = await started([...direct, ...far]);
    const result = await editAndRun(side, source);
    // Task 011-116: the 4 shortest transitive files are an edit's work too, no longer catch-up.
    expectCut(result, [...direct, ...shortest4(far)], far.slice(-1));
  });

  it("3. keeps a bare source's direct importers beside another source's namesake, by the runner's answer for it", async () => {
    const { side } = await started([OWN, ...OTHERS, ...BARE, ...transitive("t", A, 30)]);
    const asked: string[][] = [];
    const affected = side.runner.affected;
    side.runner.affected = async (paths) => {
      asked.push([...paths].sort());
      return affected(paths);
    };
    const result = await editAndRun(side, A, C);
    // a's namesake, c's six, and the 4 shortest of a's other direct importers.
    expectCut(result, [OWN, ...BARE, ...OTHERS.slice(0, 4)], OTHERS.slice(4));
    expect(asked).toEqual([[A, C], [C]]);
  });

  it("4. keeps a transitive namesake (through a barrel) as an edit's work, ahead of catch-up", async () => {
    const K = "src/k.ts";
    const own: CatchUpFile = {
      path: "test/k.test.ts",
      ms: 900,
      imports: ["src/barrel.ts"],
      through: [K],
    };
    const direct = importers("d", K, FOUR_SHORT);
    const far = transitive("t", K, 60);
    const { side } = await started([own, ...direct, ...far]);
    const result = await editAndRun(side, K);
    expectCut(result, [own, ...direct.slice(0, 4)], direct.slice(4));
    expectEditsFirst(result);
  });

  it("7. keeps every reached file an edit's work when affected fails", async () => {
    const files = [OWN, ...OTHERS, ...transitive("t", A, 30)];
    const { side } = await started(files);
    side.runner.affected = async () => {
      throw new Error("affected: no graph");
    };
    const result = await editAndRun(side, A);
    expect(result.editPaths).toEqual(pathsOf(files));
    expect(result.catchUp).toEqual([]);
  });

  it("7. keeps every direct importer when the runner's answer for the bare source is abandoned", async () => {
    const far = transitive("t", A, 30);
    const { side } = await started([OWN, ...OTHERS, ...BARE, ...far], { runnerPartMs: 1_000 });
    const affected = side.runner.affected;
    side.runner.affected = (paths) =>
      paths.length === 1 ? new Promise(() => {}) : affected(paths);
    const result = await editAndRun(side, A, C);
    // Task 011-116: the 4 shortest transitive files are an edit's work too, no longer catch-up.
    expectCut(result, [OWN, ...OTHERS, ...BARE, ...shortest4(far)], []);
    const notes = side.store.meta.get(notesMetaKey(side.worktreeId)) ?? "";
    expect(notes).toContain("abandoned");
  });
});
