import { describe, expect, it } from "vitest";
import { scenarioOf, stageInherited } from "../../evals/lib/index.mjs";

// Review 006-57 S1: a11's staging checks its own result. After the warm-up, and again once the
// fresh daemon settles, the calendar test is a known FAIL whose stored row ran at 2.40 per CPU;
// otherwise it throws, so run-cell fails the cell's setup and never grades it.

const knobs = scenarioOf("a11-inherited-flake")?.knobs as Record<string, unknown>;
type Reply = { status: number; stdout: string; stderr: string };
const ok = (stdout = ""): Reply => ({ status: 0, stdout, stderr: "" });
const known = (files: string[]) =>
  ok(JSON.stringify({ knownFailures: files.map((testPath) => ({ check: { testPath } })) }));

/** Stages with `status` answering each `status --json` in turn and `loads` the stored loads. */
async function stage(statuses: Reply[], loads: number[][], squeal?: (a: string[]) => Reply) {
  const calls: string[][] = [];
  const logged: string[] = [];
  const run = stageInherited(knobs, {
    squeal: (args: string[]) => {
      calls.push(args);
      if (squeal) return squeal(args);
      return args.includes("--json") ? (statuses.shift() ?? ok("{}")) : ok();
    },
    stop: async () => {
      calls.push(["(stop)"]);
    },
    setLoad: () => {},
    log: (s: string) => logged.push(s),
    recordedLoads: async () => loads.shift() ?? [],
  });
  return { run, calls, logged };
}

describe("a11's staging checks itself", () => {
  it("passes when the FAIL stands at 2.40 per CPU before and after the restart", async () => {
    const s = await stage(
      [known(["test/clock.test.ts"]), known(["test/clock.test.ts"])],
      [[2.4], [2.4]],
    );
    await expect(s.run).resolves.toBeTypeOf("string");
    expect(s.logged).toEqual([
      "inherited: test/clock.test.ts failed at load 2.4 per CPU; load now 0.2",
    ]);
  });

  it("throws when every Squeal command fails (the reviewer's probe)", async () => {
    const s = await stage([], [], () => ({
      status: 1,
      stdout: "",
      stderr: "daemon failed to start\n",
    }));
    await expect(s.run).rejects.toThrow(
      /^inherited: not staged by the warm-up: squeal status --json exited 1: daemon failed to start/,
    );
    expect(s.logged).toEqual([]);
    expect(s.calls).not.toContainEqual(["(stop)"]);
  });

  it("throws when the warm-up stored no FAIL of the calendar test", async () => {
    const s = await stage([known(["test/money.test.ts"])], []);
    await expect(s.run).rejects.toThrow(
      "inherited: not staged by the warm-up: test/clock.test.ts is not a known failure",
    );
  });

  it("throws when the stored FAIL ran at another load", async () => {
    const s = await stage([known(["test/clock.test.ts"])], [[0.2]]);
    await expect(s.run).rejects.toThrow(
      "inherited: not staged by the warm-up: test/clock.test.ts's stored FAIL ran at 0.20 per CPU, not 2.40",
    );
  });

  it("throws when the FAIL is gone once the fresh daemon settles", async () => {
    const s = await stage([known(["test/clock.test.ts"]), known([])], [[2.4]]);
    await expect(s.run).rejects.toThrow(
      "inherited: not staged after the fresh daemon started: test/clock.test.ts is not a known failure",
    );
    expect(s.logged).toEqual([]);
  });
});
