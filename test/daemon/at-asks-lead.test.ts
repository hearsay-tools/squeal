import { describe, expect, it } from "vitest";
import { type AtAskPorts, AtAsks } from "../../src/core/daemon/at-asks.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { CatchUpFile } from "../scheduler/catch-up-fixture.js";
import { ranPaths } from "../scheduler/group-lanes-fixture.js";
import { heldSide } from "../scheduler/held-side-fixture.js";

/*
 * Row 023-50 (round 6 V3; spec 023 D7.3): the files under a folder a call
 * names lead the commit daemon's queue as named files do. Round 6: after
 * `--at HEAD~1 test/store --run`, the commit side had 0 or 1 of 36 results
 * after 98 to 298 s, behind the earlier wide call's batch, while a single
 * named file led. Here a real scheduler, one file a tier: a wide batch
 * runs shortest first; an ask that names the folder of its two longest
 * files runs them next, after the tier in flight only.
 */

const FILES: readonly CatchUpFile[] = Array.from({ length: 8 }, (_, i) => ({
  path: i < 6 ? `test/browser/f${i}.test.ts` : `test/browser/store/s${i}.test.ts`,
  ms: 10 + i,
  imports: [`src/s${i}.ts`],
}));
const FOLDER = "test/browser/store";

describe("a folder an ask names leads the commit daemon's queue (row 023-50)", {
  timeout: 60_000,
}, () => {
  it("runs the folder's files next, ahead of the earlier wide batch", async () => {
    const { side, gate } = await heldSide(FILES);
    const all = FILES.map((f) => f.path);
    // The earlier wide call's batch.
    expect(await side.scheduler.requestGroupPaths?.("browser", all, { at: true })).toMatchObject({
      queued: all.length,
    });
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const [first] = ranPaths(side);

    const refs: TestFileRef[] = all.map((path) => ({ project: "", path }));
    const ports: AtAskPorts = {
      setup: () => ({ phase: "ready" }),
      started: async () => {},
      changedSelects: async () => refs,
      rows: () => refs.map((testFile) => ({ testFile, key: `k-${testFile.path}`, pending: null })),
      stored: () => false,
      needs: async () => new Map(),
      groupOf: () => "browser",
      request: async (group, paths, options) => {
        await side.scheduler.requestGroupPaths?.(group, paths, options);
      },
      changed: () => {},
    };
    const asks = new AtAsks(ports);
    asks.ask({
      type: "commit-ask",
      owner: "o",
      changed: ["src/s7.ts"],
      named: [FOLDER],
      allMissing: false,
    });
    await expect.poll(() => asks.snapshot().asks[0]?.phase).toBe("queued");
    const store = all.filter((path) => path.startsWith(`${FOLDER}/`));
    expect(asks.snapshot().asks[0]?.files.map((r) => r.path)).toEqual(store);

    // The tier in flight ends first; then the folder's two files, one tier each.
    gate.release();
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(2);
    gate.release();
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(3);
    expect(first?.startsWith(FOLDER)).toBe(false);
    expect(ranPaths(side).slice(1).sort()).toEqual(store);
    gate.stop();
  });
});
