import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { slotFiles } from "../../src/core/slow/slot-files.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import type { GroupSlotScope } from "../../src/core/types/capacity.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { type CatchUpRun, CatchUpRunner } from "./catch-up-fixture.js";
import {
  allCurrent,
  FILES,
  type GroupSide,
  groupPolicy,
  groupSide,
  runnerLane,
} from "./group-lanes-fixture.js";

/*
 * Row 019-18: rows 019-10 (a lane per group), 019-11 (a slot per group and
 * scope) and 019-12 (an instance and an I/O priority per lane) together. A
 * tier runs at its group's priority; a configured Vitest group's lane runs
 * in an instance of its own; a group's slot counts per repository unless
 * the host config says `"user"`, which keeps today's files.
 */

const B = "test/b.test.ts";
const C = "test/e2e/c.test.ts";

/** The priorities each lane's runs had. */
function priorities(runs: readonly CatchUpRun[]): Record<string, string[]> {
  const byLane = new Map<string, Set<string>>();
  for (const run of runs) {
    const lane = run.lane ?? "";
    byLane.set(lane, (byLane.get(lane) ?? new Set()).add(String(run.priority)));
  }
  return Object.fromEntries([...byLane].map(([lane, set]) => [lane, [...set]]));
}

/** Holds `side`'s runs in a `slow:` lane until `open`. */
function holdSlow(side: GroupSide["side"]): { open(): void } {
  let open = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  side.runner.holdOf = (run) => (run.lane?.startsWith("slow:") === true ? shut : undefined);
  return { open: () => open() };
}

/** The names in `dir` but SQLite's journals, which come and go with a held permit. */
const slotNames = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => !name.endsWith("-journal"))
        .sort()
    : [];

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A slot base directory two repositories' schedulers share, as one user's daemons do. */
function sharedBase(): string {
  const base = mkdtempSync(join(tmpdir(), "squeal-019-18-slot-"));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

/**
 * Two repositories with the default `slow` group alone (no `checks`) and
 * `maxParallel` 1, under `scope`: the first's slow run is held open before
 * the second starts.
 */
async function twoRepositories(scope: GroupSlotScope) {
  const base = sharedBase();
  const policy = groupPolicy({ slow: { maxParallel: 1 } });
  const first = await groupSide(policy, { slotDir: base, slotScope: scope });
  const held = holdSlow(first.side);
  onTestFinished(() => held.open());
  await expect
    .poll(() => readSlowActivity(first.side.store, first.side.worktreeId)?.kind, {
      timeout: 20_000,
    })
    .toBe("running");
  const second = await groupSide(policy, { slotDir: base, slotScope: scope });
  return { base, first, second, held };
}

describe("group lanes, slots and priorities together (row 019-18)", { timeout: 60_000 }, () => {
  it("runs each tier at its group's priority: a low group's low, a normal group's normal", async () => {
    const low: CheckGroup = {
      name: "low",
      runner: "vitest",
      tests: [C],
      at: "edit",
      limits: { priority: "low" },
    };
    const normal: CheckGroup = {
      name: "normal",
      runner: "vitest",
      tests: [B],
      at: "edit",
      limits: { priority: "normal" },
    };
    const { side } = await groupSide(groupPolicy({ checks: [low, normal] }));
    await allCurrent(side);
    expect(priorities(side.runner.runs)).toEqual({
      "group:low:vitest": ["low"],
      "group:normal:vitest": ["normal"],
      // The default groups keep today's: `slow` low (`ns` is slow), `tests` normal.
      "slow:node-test": ["low"],
      vitest: ["normal"],
      "node-test": ["normal"],
      pytest: ["normal"],
    });
  });

  it("runs a configured Vitest group's tiers in an instance of their own, never the fast one", async () => {
    const e2e: CheckGroup = { name: "e2e", runner: "vitest", tests: [C], at: "edit" };
    const made: [string, CatchUpRunner][] = [];
    const { side } = await groupSide(groupPolicy({ checks: [e2e] }), {
      wrapRunner: (fast) =>
        withSlowInstance(fast, (lane) => {
          const instance = new CatchUpRunner(FILES, { lane: runnerLane });
          made.push([lane, instance]);
          return instance;
        }),
    });
    await allCurrent(side);
    const ranIn = (lane: string) =>
      made
        .filter(([at]) => at === lane)
        .flatMap(([, instance]) => instance.runs.map((run) => run.files.map((f) => f.path)));
    expect(ranIn("group:e2e:vitest")).toEqual([[C]]);
    expect(side.runner.runsOf(C)).toEqual([]);
    expect(side.runner.runs.map((run) => run.lane)).not.toContain("group:e2e:vitest");
  });

  it("gives two repositories' default `slow` groups independent permits by default", async () => {
    const { base, first, second, held } = await twoRepositories("repository");
    // The second repository's slow files run while the first's run holds its one permit.
    await allCurrent(second.side);
    expect(readSlowActivity(first.side.store, first.side.worktreeId)?.kind).toBe("running");
    const dirs = [first, second].map(({ commonDir }) => slotFiles("slow").dir(base, commonDir));
    expect(new Set(dirs).size).toBe(2);
    expect(slotNames(base)).toEqual(dirs.map((dir) => dir.slice(base.length + 1)).sort());
    expect(slotNames(dirs[0] ?? "")).toEqual(["slow.lock"]);
    held.open();
    await allCurrent(first.side);
  });

  it("shares the permits across repositories under `user`, in today's files byte for byte", async () => {
    const { base, first, second, held } = await twoRepositories("user");
    await expect
      .poll(() => readSlowActivity(second.side.store, second.side.worktreeId), { timeout: 20_000 })
      .toEqual({ kind: "waiting", for: "slot" });
    // No `checks`, scope `"user"`: the base directory itself, the default group's names of before groups.
    expect(slotNames(base)).toEqual(["slow.lock", `slow.wait.${hashOf(second.side.worktreeId)}`]);
    expect(second.side.runner.runs.filter((run) => run.lane?.startsWith("slow:"))).toEqual([]);
    held.open();
    await allCurrent(first.side);
    await allCurrent(second.side);
  });

  it("names a configured group's permits `group.<name>.<i>.lock`, in its repository's directory", async () => {
    const low: CheckGroup = {
      name: "low",
      runner: "vitest",
      tests: [C, B],
      at: "edit",
      limits: { maxParallel: 2, priority: "low" },
    };
    const base = sharedBase();
    const { side, commonDir } = await groupSide(groupPolicy({ checks: [low] }), {
      slotDir: base,
      slotScope: "repository",
    });
    await allCurrent(side);
    const dir = slotFiles("low").dir(base, commonDir);
    expect(slotNames(base)).toEqual([`repo.${dir.slice(base.length + "/repo.".length)}`]);
    const names = slotNames(dir);
    expect(names).toContain("group.low.0.lock");
    expect(names.filter((name) => !/^(slow(\.\d+)?|group\.low\.\d+)\.lock$/.test(name))).toEqual(
      [],
    );
  });
});
