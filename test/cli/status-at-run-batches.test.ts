import { describe, expect, it } from "vitest";
import { Batches, stopMargin, tellsEstimate } from "../../src/cli/status-at-run-batches.js";

/*
 * Row 023-19 (lessons P3): `--run`'s batch sizes from this machine and the
 * time measured, when it tells the estimate first, and the hard stop's
 * margin. `status-at-run-budget.test.ts` runs them on a fixture.
 */

describe("--run's batches and estimate rule (row 023-19, P3)", () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `t/${i}.test.ts`);
  const none = () => null;

  it("starts with one round of the machine's width when nothing is stored, then sizes by measured time", () => {
    const batches = new Batches(300, { width: 8 });
    expect(batches.next(paths(100), none)).toBe(8);
    // 8 paths took 16 s: 2 s each; the aim is a fifth of 300 s, 60 s: 30 paths.
    batches.took(8, 16);
    expect(batches.next(paths(92), none)).toBe(30);
    expect(batches.next(paths(5), none)).toBe(5);
    expect(new Batches(300, { fixed: 2 }).next(paths(5), none)).toBe(2);
  });

  it("starts from the stored durations over the width when they are stored", () => {
    // 10 s each over a width of 2: 5 s of work per path; 60 s of aim: 12 paths.
    expect(new Batches(300, { width: 2 }).next(paths(40), () => 10)).toBe(12);
    // A short budget still aims at 20 s.
    expect(new Batches(30, { width: 1 }).next(paths(40), () => 10)).toBe(2);
  });

  it("tells the estimate with --all-missing, over half the time left, or past one round unknown", () => {
    const estimate = { runner: "vitest", files: 30, known: 30, width: 8 } as const;
    expect(tellsEstimate({ ...estimate, seconds: 100 }, false, 300)).toBe(false);
    expect(tellsEstimate({ ...estimate, seconds: 151 }, false, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: 1 }, true, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: null, known: 0 }, false, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: null, files: 8 }, false, 300)).toBe(false);
  });

  it("keeps a tenth of the time left for the gate to answer, 5 s to 60 s", () => {
    expect(stopMargin(20)).toBe(5);
    expect(stopMargin(280)).toBe(28);
    expect(stopMargin(2000)).toBe(60);
  });
});
