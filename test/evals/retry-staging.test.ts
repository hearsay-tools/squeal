import { describe, expect, it } from "vitest";
import { scenarioOf, stageInherited } from "../../evals/lib/index.mjs";

// Review 006-57 S1: a11's staging checks its own result. Once the warm-up ran, the calendar
// test is a known FAIL whose stored row ran at 2.40 per CPU; otherwise it throws, so run-cell
// fails the cell's setup and never grades it.
// 006-62, finding 4: the load drops only once a wait on the calendar test returned (a plain
// wait returns before the baseline runs it, and the pilot's FAIL was stored at 0.20), and the
// warm-up's daemon is kept (Squeal empties its temp directory, the calendar's cache, at each
// start, so a fresh daemon's retry ran cold and timed out again). Staging precedes the session
// and is the same for both harnesses.

const knobs = scenarioOf("a11-inherited-flake")?.knobs as Record<string, unknown>;
type Reply = { status: number; stdout: string; stderr: string };
const ok = (stdout = ""): Reply => ({ status: 0, stdout, stderr: "" });
const known = (files: string[]) =>
  ok(JSON.stringify({ knownFailures: files.map((testPath) => ({ check: { testPath } })) }));

/** Stages with `status` answering each `status --json` in turn and `loads` the stored loads. */
async function stage(statuses: Reply[], loads: number[][], squeal?: (a: string[]) => Reply) {
  const calls: string[][] = [];
  const logged: string[] = [];
  let load: number | null = null;
  const run = stageInherited(knobs, {
    squeal: (args: string[], opts?: { env?: Record<string, string> }) => {
      calls.push([...args, `@${load}`, `cold=${opts?.env?.LEDGERLINE_CALENDAR_COLD_RUNS ?? "-"}`]);
      if (squeal) return squeal(args);
      return args.includes("--json") ? (statuses.shift() ?? ok("{}")) : ok();
    },
    stop: async () => {
      calls.push(["(stop)"]);
    },
    setLoad: (perCpu: number) => {
      load = perCpu;
    },
    log: (s: string) => logged.push(s),
    recordedLoads: async () => loads.shift() ?? [],
  });
  return { run, calls, logged };
}

describe("a11's staging", () => {
  it("waits on the calendar test at 2.40 per CPU before the load drops, and keeps its daemon", async () => {
    const s = await stage([known(["test/clock.test.ts"])], [[2.4]]);
    await expect(s.run).resolves.toBeTypeOf("string");
    expect(s.calls).toEqual([
      ["start", "@2.4", "cold=2"],
      ["status", "--wait", "300000", "@2.4", "cold=2"],
      ["status", "--wait", "300000", "test/clock.test.ts", "@2.4", "cold=2"],
      ["run", "--all", "--wait", "@0.2", "cold=2"],
      ["status", "--json", "@0.2", "cold=-"],
    ]);
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
});
