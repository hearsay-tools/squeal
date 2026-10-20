import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { changedSources, type Range, type SourceSide, unrun } from "./coverage.js";

/*
 * The coverage proof reads each process's V8 report on its own (review of
 * cand/0.1.228): a line ran when it ran in any process. Merged into one list,
 * a process that never called the function, or that skipped a branch V8
 * reports for it alone, outvoted the process where the line ran.
 */

const TEXT = ["function f(x) {", "  if (x) {", "    return 1;", "  }", "  return 2;", "}"].join(
  "\n",
);
const block = { start: TEXT.indexOf("{\n    return 1"), end: TEXT.indexOf("\n  return 2") };
const fn = (count: number): Range => ({ start: 0, end: TEXT.length, count });

// V8 drops a nested range whose count equals its parent's, so a taken branch has none.
const neverCalled: Range[] = [fn(0)];
const branchTaken: Range[] = [fn(1)];
const branchSkipped: Range[] = [fn(1), { ...block, count: 0 }];

describe("unrun, over one report per process", () => {
  it("counts a line that ran in one process beside one that never called its function", () => {
    expect(unrun(TEXT, [neverCalled, branchTaken], [3, 5])).toEqual([]);
    expect(unrun(TEXT, [branchTaken, neverCalled], [3, 5])).toEqual([]);
  });

  it("counts a branch taken in one process beside one that skipped it", () => {
    expect(unrun(TEXT, [branchSkipped, branchTaken], [3])).toEqual([]);
    expect(unrun(TEXT, [branchTaken, branchSkipped], [3])).toEqual([]);
  });

  it("names a line no process ran", () => {
    expect(unrun(TEXT, [neverCalled, branchSkipped], [3, 5])).toEqual([3]);
    expect(unrun(TEXT, [neverCalled], [3, 5])).toEqual([3, 5]);
    expect(unrun(TEXT, [], [3])).toEqual([3]);
  });

  // Row 011-41: esbuild prints `}, b = 2, c = 3) {` after a default `a = () => {` never called.
  it("reads a line after the brackets that close an earlier block, unless it holds only those", () => {
    const text = ["function g(a = () => {", "}, b = 2) {", "  return b;", "}"].join("\n");
    const fallback = { start: text.indexOf("() => {"), end: text.indexOf(", b = 2"), count: 0 };
    const called: Range[] = [{ start: 0, end: text.length, count: 1 }, fallback];
    expect(unrun(text, [called], [2, 3, 4])).toEqual([]);
    const closing = ["function h() {", "  if (x) {", "    y();", "  }", "}"].join("\n");
    const skipped: Range[] = [
      { start: 0, end: closing.length, count: 1 },
      { start: closing.indexOf("{\n    y"), end: closing.indexOf("\n}"), count: 0 },
    ];
    expect(unrun(closing, [skipped], [3, 4])).toEqual([3, 4]);
  });
});

/*
 * Task 011-40 (the coordinator's conditions of 2026-10-20): a source line is
 * changed by the trees, not by which bundle holds it. Once the candidate's
 * harness reads the accept rule from `accept.ts`, its bundle holds no
 * `Ledger`, whose unchanged lines must not need a case at the release.
 */
describe("changedSources, by the trees' files", () => {
  const dir = mkdtempSync(join(tmpdir(), "squeal-changed-sources-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const trees = { baseline: join(dir, "baseline"), candidate: join(dir, "candidate") };
  const write = (side: keyof typeof trees, path: string, text: string) => {
    mkdirSync(dirname(join(trees[side], path)), { recursive: true });
    writeFileSync(join(trees[side], path), text);
  };
  /** A side whose bundle compiled `paths`, each from its tree's file. */
  const side = (name: keyof typeof trees, paths: readonly string[]): SourceSide => ({
    tree: trees[name],
    map: {
      sources: paths.map((p) => join(trees[name], p)),
      sourcesContent: paths.map((p) => readFileSync(join(trees[name], p), "utf8")),
      mappings: "",
    },
  });
  const changed = (baseline: SourceSide, candidate: SourceSide) => {
    const out = changedSources(baseline, candidate, join(dir, "diff"));
    return { baseline: [...out.baseline].sort(), candidate: [...out.candidate].sort() };
  };

  it("counts every line of a path only one tree has, at that side", () => {
    write("candidate", "src/accept.ts", "a\nb\n");
    write("baseline", "src/gone.ts", "c\n");
    expect(
      changed(side("baseline", ["src/gone.ts"]), side("candidate", ["src/accept.ts"])),
    ).toEqual({
      baseline: ["src/gone.ts:1"],
      candidate: ["src/accept.ts:1", "src/accept.ts:2"],
    });
  });

  it("counts the diff of a path whose texts differ at each side, deleted lines at the baseline included", () => {
    write("baseline", "src/ledger.ts", "keep\nprobe\nkeep\n");
    write("candidate", "src/ledger.ts", "keep\nkeep\nlookup\n");
    const expected = { baseline: ["src/ledger.ts:2"], candidate: ["src/ledger.ts:3"] };
    // Held by both bundles, and by the baseline's only: the trees decide.
    expect(
      changed(side("baseline", ["src/ledger.ts"]), side("candidate", ["src/ledger.ts"])),
    ).toEqual(expected);
    expect(changed(side("baseline", ["src/ledger.ts"]), side("candidate", []))).toEqual(expected);
  });

  it("counts no line of a path the trees hold alike, even when one bundle holds it", () => {
    write("baseline", "src/queue.ts", "q\n");
    write("candidate", "src/queue.ts", "q\n");
    expect(changed(side("baseline", ["src/queue.ts"]), side("candidate", []))).toEqual({
      baseline: [],
      candidate: [],
    });
  });

  it("reads the candidate's overlay where its bundle does not hold the path", () => {
    write("baseline", "src/overlaid.ts", "x\n");
    write("candidate", "src/overlaid.ts", "x\n");
    const candidate = { ...side("candidate", []), overlay: { "src/overlaid.ts": "y\n" } };
    expect(changed(side("baseline", ["src/overlaid.ts"]), candidate)).toEqual({
      baseline: ["src/overlaid.ts:1"],
      candidate: ["src/overlaid.ts:1"],
    });
  });
});
