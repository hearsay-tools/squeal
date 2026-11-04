import { describe, expect, it } from "vitest";
import type { CheckGroup } from "../../src/core/types/index.js";
import type { CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";
import { groupPolicy, groupSide, tierLog } from "./group-lanes-fixture.js";

/*
 * Row 019-27 (spec 019 D3, `priority`; 019-26's known limit): a `low`
 * group's lane takes several files only while no `normal` work may run.
 * A `normal` group at `commit` keeps the files no commit asked for queued:
 * they run for no one until a later commit or `squeal run <group>`, so
 * they leave the `low` group its width. Its asked work still narrows it.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const C = "test/e2e/c.test.ts";

/** `pre`, `normal` at `commit`, owns A; `low` follows `tests` and may run 2 files at once. */
const CHECKS: readonly CheckGroup[] = [
  { name: "pre", runner: "vitest", tests: [A], at: "commit" },
  {
    name: "low",
    runner: "vitest",
    tests: [B, C],
    at: "edit",
    after: ["tests"],
    limits: { maxParallel: 2, priority: "low" },
  },
];

/** Holds the runs `holds` picks until the returned call for that lane. */
function gates(side: CatchUpSide, holds: Record<string, (run: CatchUpRun) => boolean>) {
  const open = new Map<string, () => void>();
  const shut = new Map<string, Promise<void>>();
  for (const name of Object.keys(holds)) {
    shut.set(name, new Promise<void>((resolve) => open.set(name, resolve)));
  }
  side.runner.holdOf = (run) => {
    const name = Object.keys(holds).find((key) => holds[key]?.(run) === true);
    return name === undefined ? undefined : shut.get(name);
  };
  return (name: string) => open.get(name)?.();
}

const lowTiers = (side: CatchUpSide) =>
  (tierLog(side.runner.runs)["group:low:vitest"] ?? []).map((paths) => [...paths].sort());

describe("a low group's width beside a normal commit group (019-27)", { timeout: 60_000 }, () => {
  it("takes both files in one tier while the commit group's unasked file stays queued", async () => {
    const { side } = await groupSide(groupPolicy({ checks: CHECKS }));
    await expect
      .poll(() => [B, C].every((path) => side.current(path)), { timeout: 20_000 })
      .toBe(true);
    await side.scheduler.idle();
    expect(side.current(A), "no commit asked for it").toBe(false);
    expect(side.runner.runsOf(A)).toEqual([]);
    expect(lowTiers(side)).toEqual([[B, C]]);
  });

  it("runs one file a tier while the commit group's requested file runs", async () => {
    let open: (name: string) => void = () => {};
    const { side } = await groupSide(groupPolicy({ checks: CHECKS }), {
      beforeStart: async (s) => {
        open = gates(s, {
          tests: (run) => run.lane === "node-test" || run.lane === "pytest",
          pre: (run) => run.lane === "group:pre:vitest",
        });
      },
    });
    expect(await side.scheduler.requestGroup("pre")).toMatchObject({ queued: 1 });
    await expect.poll(() => side.runner.runsOf(A).length, { timeout: 20_000 }).toBe(1);
    open("tests");
    await expect
      .poll(() => [B, C].every((path) => side.current(path)), { timeout: 20_000 })
      .toBe(true);
    expect(side.current(A), "its run is still held").toBe(false);
    expect(lowTiers(side).sort()).toEqual([[B], [C]]);
    open("pre");
    await expect.poll(() => side.current(A), { timeout: 20_000 }).toBe(true);
  });
});
