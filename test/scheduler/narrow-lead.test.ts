import { describe, expect, it } from "vitest";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { ranPaths } from "./group-lanes-fixture.js";
import { heldSide } from "./held-side-fixture.js";

/*
 * Review wave-20 B2 (row 023-34; spec 023 D4.11): "files a later call
 * names run ahead of earlier `--run` work", also while the earlier call
 * still runs (a call the harness moved to the background). In 0.1.586 a
 * later batch ranked after the earlier one and could not take a file out
 * of it: promoting `[a,b]`, then `[b]`, left the order `[a,b]`. A leading
 * batch (`lead`) takes its files out of earlier batches and ranks ahead of
 * every other, the later first. The tier in flight is left alone.
 */

const ref = (path: string) => ({ project: "", path });

describe("a leading batch (B2)", () => {
  it("moves a file out of an earlier batch and ahead of it", () => {
    const q = new RunQueue({ now: () => 1_000, isRunning: () => false });
    q.add(ref("a"), Priority.neverRun);
    q.add(ref("b"), Priority.neverRun);
    q.add(ref("c"), Priority.neverRun);
    q.promote([ref("a"), ref("b"), ref("c")], 60_000);
    expect(q.ordered(() => null)).toEqual([ref("a"), ref("b"), ref("c")]);
    // An ordinary later wait keeps its place behind the earlier batch.
    q.promote([ref("c")], 60_000);
    expect(q.ordered(() => null)[0]).toEqual(ref("a"));
    // A later call that named `b` leads.
    q.promote([ref("b")], 60_000, undefined, true);
    expect(q.ordered(() => null)).toEqual([ref("b"), ref("a"), ref("c")]);
    expect(q.orderedBatches(() => null)[0]).toEqual(ref("b"));
    // A still later named call leads that one.
    q.promote([ref("c")], 60_000, undefined, true);
    expect(q.ordered(() => null)).toEqual([ref("c"), ref("b"), ref("a")]);
  });
});

const FILES: readonly CatchUpFile[] = Array.from({ length: 8 }, (_, i) => ({
  path: `test/browser/f${i}.test.ts`,
  ms: 10 + i,
  imports: [`src/s${i}.ts`],
}));

describe("an overlapping wide call, then a call that names a file (B2)", {
  timeout: 60_000,
}, () => {
  it("runs the named file next, after the tier in flight only", async () => {
    const { side, gate } = await heldSide(FILES);
    const all = FILES.map((f) => f.path);
    const wide = await side.scheduler.requestGroupPaths?.("browser", all);
    expect(wide).toMatchObject({ queued: all.length });
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const [first] = ranPaths(side);
    // The file shortest-first would run last, named by a later call.
    const named = all.at(-1) ?? "";
    const request = await side.scheduler.requestGroupPaths?.("browser", [named], { lead: true });
    expect(request).toMatchObject({ queued: 1 });
    // The tier in flight is not cut: it ends first.
    gate.release();
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(2);
    expect(ranPaths(side)).toEqual([first, named]);
    gate.stop();
  });
});
