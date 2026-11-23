import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool } from "../../src/core/capacity/pool.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { groupPolicy, inTurn, runnerLane } from "./group-lanes-fixture.js";

/*
 * Row 023-71 (round 9 Y1): a `status --at <c> <file> --run` names a file of
 * squawk's browser group (`at: manual`, `maxParallel: 1`, `maxWorkers: 1`,
 * `priority: low`). The commit daemon and the working tree's daemon are two
 * worktrees of one repository: they share the group's slot and the pool.
 * The working tree runs the group's other files one after another. The
 * named file at the commit starts at the next free slot, ahead of the
 * working tree's next file that no call named, and a full pool does not
 * hold it. These pass without a change (see `023-71-notes.md`): neither the
 * pool nor the slot is what held round 9's file.
 */

const BROWSER_FILES = ["a", "b", "c", "d", "e"].map((n) => `test/browser/${n}.test.ts`);
const FILES: readonly CatchUpFile[] = BROWSER_FILES.map((path) => ({
  path,
  ms: 10,
  imports: ["src/core.ts"],
}));
const NAMED = "test/browser/e.test.ts";

const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
  limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
};

interface Sides {
  readonly repo: CatchUpRepo;
  /** The working tree's daemon: its runs wait for `open`. */
  readonly tree: CatchUpSide;
  /** The commit daemon: its file keys differ from the tree's. */
  readonly commit: CatchUpSide;
  /** Lets the tree's `n`-th run (from 0) end. */
  open(n: number): void;
}

/** Every participant's pool: the capacity `catchUpSide` gives both sides' schedulers. */
const POOL = { hostSlots: 8, cpus: 64, host: null } as const;

async function sides(load = 0): Promise<Sides> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-023-71-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const policy = groupPolicy({ checks: [BROWSER] });
  const options = {
    files: FILES,
    hostSlots: POOL.hostSlots,
    tierSize: 1,
    lane: runnerLane,
    policy,
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [load] } },
  };
  const tree = catchUpSide(repo, repo.main, options);
  const commit = catchUpSide(repo, repo.other, options);
  // The commit's sources differ from the working tree's, so no file shares a key.
  commit.touch("src/core.ts");
  const gates: (() => void)[] = [];
  const shut: Promise<void>[] = [];
  const gate = (n: number) => {
    while (shut.length <= n) shut.push(new Promise<void>((open) => gates.push(open)));
    return shut[n];
  };
  let runs = 0;
  tree.runner.holdOf = () => gate(runs++);
  const turns = [await inTurn(tree), await inTurn(commit)];
  onTestFinished(async () => {
    for (const open of gates) open();
    for (const turn of turns) await turn.end();
  });
  await tree.scheduler.start();
  await commit.scheduler.start();
  await tree.rest();
  await commit.rest();
  return {
    repo,
    tree,
    commit,
    open: (n) => {
      void gate(n);
      gates[n]?.();
    },
  };
}

const browserRuns = (side: CatchUpSide): string[][] =>
  side.runner.runs
    .filter((run) => (run.lane ?? "").startsWith("group:browser:"))
    .map((run) => run.files.map((f) => f.path));

describe("a named file waits for a shared group slot (row 023-71)", { timeout: 60_000 }, () => {
  it("takes the slot when the working tree's file ends, ahead of its next unnamed file", async () => {
    const { tree, commit, open } = await sides();
    // The first `--run` call: every browser file on both sides, none named.
    await tree.scheduler.requestGroupPaths?.("browser", BROWSER_FILES, { at: true });
    await expect.poll(() => browserRuns(tree).length, { timeout: 20_000 }).toBe(1);
    await commit.scheduler.requestGroupPaths?.("browser", BROWSER_FILES, { at: true });
    // The narrowed call names one file: it leads the commit daemon's queue.
    await commit.scheduler.requestGroupPaths?.("browser", [NAMED], { at: true, lead: true });
    await commit.rest();
    expect(browserRuns(commit)).toEqual([]);
    // The commit's run holds the slot until this test reads the order.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    commit.runner.holdOf = () => held;
    open(0);
    await expect.poll(() => browserRuns(commit).length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(browserRuns(commit)[0]).toEqual([NAMED]);
    // The working tree's next file waits for the named one.
    await commit.rest();
    expect(browserRuns(tree).length).toBe(1);
    release();
    await expect.poll(() => browserRuns(tree).length, { timeout: 20_000 }).toBe(2);
  });

  it.each([
    ["an idle host", 0],
    ["a host loaded 5 per CPU", 5],
  ])(
    "starts on %s with every pool permit held by another daemon's background tier",
    async (_, load) => {
      const { repo, commit } = await sides(load);
      // The same CPU and host inputs as both sides' pools (`catchUpSide`): the
      // real CPU count would cap a background tier at 75% of it (3 of 8 on a
      // 4-CPU host), and the pool would not be full (review 0.1.611 B2).
      const other = createPermitPool({
        dir: repo.poolDir,
        owner: { pid: process.pid, worktreeId: "background-daemon" },
        ...POOL,
      });
      onTestFinished(() => other.close());
      expect(other.acquire(200, "fast", 1, "backlog")?.grant).toBe(POOL.hostSlots);
      await commit.scheduler.requestGroupPaths?.("browser", [NAMED], { at: true, lead: true });
      await expect.poll(() => commit.current(NAMED), { timeout: 20_000 }).toBe(true);
      expect(browserRuns(commit)).toEqual([[NAMED]]);
    },
  );
});
