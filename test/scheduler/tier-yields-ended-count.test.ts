import { describe, expect, it } from "vitest";
import { classLines } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { ENDED_WRITE_MS } from "../../src/core/scheduler/yield-history.js";
import { readYieldRow } from "../../src/core/scheduler/yield-row.js";
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
  const writes: { at: number; ended?: Record<string, number>; endedFiles?: unknown }[] = [];
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

/** A tier of `n` files `f<i>`; `end(i)` names file i ended, as the runner would. */
function tierOf(n: number) {
  const files = Array.from({ length: n }, (_, i) => ({
    file: { id: `f${i}`, ref: { project: "", path: `f${i}` } },
  }));
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

  it("row 011-274: the row names the files that ended, in the tier's order, as of its write", () => {
    const { context, writes, at } = recording();
    const yields = new TierYields();
    const { tier, end } = tierOf(4);
    end(2);
    yields.fileEnded(context, tier);
    // Inside the window: written by the next write, not this one.
    end(0);
    yields.fileEnded(context, tier);
    at.ms += ENDED_WRITE_MS;
    end(3);
    yields.fileEnded(context, tier);
    const path = (i: number) => ({ project: "", path: `f${i}` });
    expect(writes.map((w) => [w.ended, w.endedFiles])).toEqual([
      [{ r1: 1 }, { r1: [path(2)] }],
      [{ r1: 3 }, { r1: [path(0), path(2), path(3)] }],
    ]);
    const row = readYieldRow(JSON.stringify(writes[1]), 0);
    expect(row.at).toBe(at.ms);
    expect(row.endedFiles).toEqual(new Map([["r1", [path(0), path(2), path(3)]]]));
    // A list that does not read is dropped; its count still reads.
    const bad = readYieldRow(JSON.stringify({ ...writes[1], endedFiles: { r1: [1] } }), 0);
    expect([bad.endedFiles.size, bad.ended.get("r1")]).toEqual([0, 3]);
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
    // Row 011-274 (gh-111): the file that ended reads in a line of its own (`tier-file-end.test.ts`).
    expect(classLines(read(), "squeal").slice(1)).toEqual([
      expect.stringMatching(
        /^ {2}1 ended at revision \d+, awaiting the tier's final checks and 3 files not reported ended as of \S+ \(test\/s2\.test\.ts, test\/s3\.test\.ts, test\/s4\.test\.ts\), in the vitest tier of 4 test files running since \S+, 1 of them ended: test\/s1\.test\.ts;/,
      ),
      expect.stringMatching(
        /^ {2}3 in the vitest tier of 4 test files running since \S+, 1 of them ended: test\/s2/,
      ),
    ]);
    hold.stop();
    await side.scheduler.idle();
  });
});
