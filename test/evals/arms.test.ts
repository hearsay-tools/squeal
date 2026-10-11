import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { armFixtures, buildFixture, cellArgs, resultsName, runId } from "../../evals/lib/index.mjs";

// Review 006-03 B5 and S1, without a model: each arm's fixture is its own identity, and two runs
// of one commit keep separate cells and separate results files.
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-arms-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const variant = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../evals/variants/${name}.json`, import.meta.url), "utf8"));
const build = (name: string) =>
  buildFixture({ work: join(scratch(), "work"), variant: variant(name), env: process.env });

describe("each arm's fixture (B5)", () => {
  it("is the same commit for every cell of an arm, and its own commit per instruction arm", () => {
    const p0 = build("p0");
    expect(build("p0")).toBe(p0);
    const gate = build("gate-squeal");
    expect(gate).not.toBe(p0);
    expect(build("gate-squeal")).toBe(gate);
    expect(build("d8-deny")).not.toBe(p0);
  });

  it("partitions graded cells by arm and accepts two legitimate arms", () => {
    const grades = [
      { variant: "p0", head: "aaa" },
      { variant: "gate-squeal", head: "bbb" },
      { variant: "p0", head: "aaa" },
    ];
    expect(armFixtures(grades, ["p0", "gate-squeal"])).toEqual({ p0: "aaa", "gate-squeal": "bbb" });
    expect(armFixtures([], ["p0"])).toEqual({ p0: null });
  });

  it("rejects drift within an arm", () => {
    expect(() =>
      armFixtures(
        [
          { variant: "p0", head: "aaa" },
          { variant: "p0", head: "ccc" },
          { variant: "gate-squeal", head: "bbb" },
        ],
        ["p0", "gate-squeal"],
      ),
    ).toThrow(/arm p0 ran on 2 fixture commits: aaa, ccc/);
  });
});

describe("a run's identity (S1)", () => {
  it("is fresh per run", () => {
    const a = runId(new Date("2026-10-11T06:00:00Z"));
    const b = runId(new Date("2026-10-11T06:00:00Z"));
    expect(a).toMatch(/^20261011T060000Z-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });

  it("gives a cell a fresh run unless it names one, and resumes only a named run", () => {
    const cell = ["t1-thousands", "p0", "claude", "claude-haiku-5-5"];
    const fresh = () => "fresh-run";
    expect(cellArgs(cell, { runId: fresh })).toMatchObject({ run: "fresh-run", resume: false });
    expect(cellArgs([...cell, "--run", "r1", "--resume"], { runId: fresh })).toMatchObject({
      run: "r1",
      resume: true,
      rep: "1",
    });
    expect(() => cellArgs([...cell, "--resume"])).toThrow(/--resume needs --run/);
    expect(() => cellArgs(["t1-thousands", "p0", "claude", "claude-opus-5-5"])).toThrow(/Opus/);
  });

  it("names each run's results file uniquely, the variant last", () => {
    const run = "20261011T060000Z-abc123";
    expect(resultsName({ date: "2026-10-11", version: "0.1.120", run })).toBe(
      "2026-10-11-0.1.120.20261011T060000Z-abc123.json",
    );
    expect(resultsName({ date: "2026-10-11", version: "0.1.120", run, variant: "p1" })).toBe(
      "2026-10-11-0.1.120.20261011T060000Z-abc123.p1.json",
    );
  });
});
