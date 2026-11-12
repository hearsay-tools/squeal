import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT } from "../fake-channel.js";
import { background, ENV, options, REF, setup } from "./lane-fixture.js";

/*
 * Spec 021 D11 to D13 (row 021-14): the lane sends background runs to the
 * remote and keeps a result only over a proven tree and an equal
 * environment; a refusal sends the files again and retries once; a lost or
 * hung host ends its attempt incomplete, and the policy decides what follows.
 * The host is served in this process over a real proxy and tree host.
 */

describe("a remote lane (row 021-14)", () => {
  it("runs a background tier on the remote, proven, and every other run here", async () => {
    const s = await setup();
    await s.lane.run([REF], options());
    await s.lane.run([REF], background({ lane: "slow:vitest" }));
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(2);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("completed");
    expect(s.remoteRuns).toEqual(["test/a.test.ts"]);
    expect(s.statuses.at(-1)).toMatch(/^remote box: background runs of vitest go there; proven at/);
    expect(report).not.toHaveProperty("proof");
  });

  it("refuses a tree that differs before the run, sends the files again, and runs the retry", async () => {
    const s = await setup();
    writeFileSync(join(s.remoteRoot, "src/a.ts"), "drifted\n");
    await s.lane.run([REF], background());
    expect(s.logs).toContain("remote box: tree differs at src/a.ts; sending again");
    expect(readFileSync(join(s.remoteRoot, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(0);
  });

  it("keeps no result of a run whose tree moved during it, twice: it runs here", async () => {
    const s = await setup({
      remoteRun: async (remoteRoot) => {
        writeFileSync(join(remoteRoot, "src/a.ts"), `moved ${Math.random()}\n`);
        return REPORT;
      },
    });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toBe(
      "remote box: refused a run whose tree stayed different; ran it here",
    );
  });

  it("refuses a remote whose environment differs, and names the difference", async () => {
    const s = await setup({ remoteEnv: { ...ENV, runnerVersion: "5.0.2" } });
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box refused: .*5\.0\.2 on the remote, 5\.0\.3 here; running here$/,
    );
  });

  it("ends a hung remote's attempt within its deadline, runs its files here, and reconnects later", async () => {
    const s = await setup({
      deadlines: { aliveMs: 200 },
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const started = Date.now();
    const report = await s.lane.run([REF], background());
    // Review 0.1.442 B4: under `local`, the lost attempt's files run here at once.
    expect(report.end).toBe("completed");
    expect(s.localRuns).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(s.statuses.at(-1)).toMatch(
      /^remote box unreachable since .* \(the vitest runner host did not answer run, nor tell it is alive, within 200 ms; Squeal stopped it\); running here$/,
    );
    await s.lane.run([REF], background());
    expect(s.localRuns).toHaveLength(2);
    expect(s.connects).toHaveLength(1);
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
  });

  it("ends a lost remote's run unknown under whenLost not-run, and counts its files", async () => {
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 200 },
      remoteRun: (_, hang) => {
        hang();
        return new Promise(() => {});
      },
    });
    const lost = await s.lane.run([REF], background());
    expect(lost.end).toBe("timed-out");
    expect(lost.completedFiles).toEqual([]);
    const report = await s.lane.run([REF], background());
    expect(report.end).toBe("crashed");
    expect(report.failure).toMatch(/not run here/);
    expect(s.localRuns).toHaveLength(0);
    expect(s.statuses.at(-1)).toMatch(/unreachable since .*; 2 files not run$/);
  });
});
