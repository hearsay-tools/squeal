import { describe, expect, it } from "vitest";
import { classLines } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { ENDED_WRITE_MS } from "../../src/core/scheduler/yield-history.js";
import { TierYields, yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-209, `research/issue-91.md` F4 (spec 011 C15): a running tier says
 * how many of its files ended. The daemon writes the count from the runner's
 * file-end callback at most once per `ENDED_WRITE_MS` per worktree (the
 * coordinator's bound, request dd6ee382): a file end inside that window
 * writes nothing, and the next allowed write carries the newest count.
 */
const WT = "w1";

/** A context whose store records each write of the `yields` row, its clock at `at.ms`. */
function recording() {
  const writes: { ended?: Record<string, number> }[] = [];
  const at = { ms: 1_000_000 };
  const store = { busy: false };
  const meta = {
    get: () => null,
    delete: () => {},
    set: (key: string, value: string) => {
      if (store.busy) throw Object.assign(new Error("database is locked"), { errcode: 5 });
      if (key === yieldsMetaKey(WT)) writes.push(JSON.parse(value));
    },
  };
  const context = { store: { meta }, worktreeId: WT, now: () => at.ms };
  return { context: context as unknown as SchedulerContext, writes, at, store };
}

/** A tier of `n` files of which the runner named the first `ended` ended. */
function tierOf(n: number) {
  const files = Array.from({ length: n }, (_, i) => ({ file: { id: `f${i}` } }));
  const tier = { runId: "r1", lane: "vitest", files, ended: new Set<string>() };
  return {
    tier: tier as unknown as Tier,
    end: (i: number) => tier.ended.add(`f${i}`),
  };
}

describe("a running tier's ended files (row 011-209, issue-91 F4)", { timeout: 120_000 }, () => {
  it("many file ends inside the window make one write; one after it writes the new count", () => {
    const { context, writes, at } = recording();
    const yields = new TierYields();
    const { tier, end } = tierOf(1_000);
    for (let i = 0; i < 500; i += 1) {
      end(i);
      yields.fileEnded(context, tier);
      at.ms += 1;
    }
    expect(writes.map((w) => w.ended)).toEqual([{ r1: 1 }]);
    at.ms += ENDED_WRITE_MS;
    end(500);
    yields.fileEnded(context, tier);
    expect(writes.map((w) => w.ended)).toEqual([{ r1: 1 }, { r1: 501 }]);
  });

  it("a busy store skips the write, and the next allowed one carries the count", () => {
    const { context, writes, at, store } = recording();
    const yields = new TierYields();
    const { tier, end } = tierOf(4);
    store.busy = true;
    end(0);
    expect(() => yields.fileEnded(context, tier)).not.toThrow();
    expect(writes).toEqual([]);
    store.busy = false;
    at.ms += ENDED_WRITE_MS;
    end(1);
    yields.fileEnded(context, tier);
    expect(writes.map((w) => w.ended)).toEqual([{ r1: 2 }]);
  });

  it("the running line says how many of its files ended, as the daemon wrote it", async () => {
    const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
    const files: CatchUpFile[] = SLOW.map((path) => ({ path, ms: 20_000, imports: ["src/s.ts"] }));
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    // The runner names the first file ended as the run starts, as Vitest's `onTestModuleEnd` would.
    const run = side.runner.run.bind(side.runner);
    side.runner.run = async (refs, options) => {
      const first = refs.find((f) => f.path === SLOW[0]);
      if (first !== undefined) setTimeout(() => options.fileEnded?.(first), 0);
      return run(refs, options);
    };
    const base = side.runner.runs.length;
    const hold = holdRuns(side.runner, (path) => SLOW.includes(path));
    await side.edit("watch", "src/s.ts");
    await heldRun(side, SLOW[0] ?? "", base);
    const named: TestFileRef[] = SLOW.map((path) => ref(path));
    const read = () => {
      const { store, worktreeId, root } = side;
      const now = Date.now();
      const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
      return standingsOf(store, worktreeId, root, daemon, now)(named);
    };
    await expect
      .poll(() => read()[0]?.standing, { timeout: 10_000 })
      .toMatchObject({
        kind: "running",
        ended: 1,
      });
    expect(classLines(read(), "squeal")[1]).toMatch(
      /^ {2}4 in the vitest tier of 4 test files running since \S+, 1 of them ended: test\/s1/,
    );
    hold.stop();
    await side.scheduler.idle();
  });
});
