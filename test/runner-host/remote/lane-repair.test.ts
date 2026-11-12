import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Review 0.1.442 (row 021-14 repair R1). B2: signs of life prove the
 * transport, not the run: a run without a test timeout whose files stop
 * ending is lost.
 */

describe("review 0.1.442 repairs of the remote lane", () => {
  it("B2: ends a run without a test timeout whose files stop ending, though its host stays alive", async () => {
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 100, runIdleMs: 400 },
      remoteRun: () => new Promise(() => {}),
    });
    const started = Date.now();
    const report = await s.lane.run([REF], background({ timeoutMs: null }));
    expect(report.end).toBe("timed-out");
    expect(report.results).toEqual([]);
    expect(report.failure).toMatch(/nor end a file of it, within 400 ms/);
    expect(Date.now() - started).toBeLessThan(3_000);
    // A new host replaces it once the backoff passed.
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
  });

  it("B2: keeps a long run without a test timeout whose files go on ending", async () => {
    const s = await setup({
      deadlines: { aliveMs: 100, runIdleMs: 400 },
      remoteRun: async (_root, _hang, options) => {
        for (let i = 0; i < 6; i++) {
          await sleep(150);
          options.fileEnded?.(REF);
        }
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const report = await s.lane.run([REF], background({ timeoutMs: null }));
    expect(report.end).toBe("completed");
    expect(s.localRuns).toHaveLength(0);
  });
});
