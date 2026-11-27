import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import { background, ENV, REF, setup } from "./lane-fixture.js";

/*
 * Row 026-40 (#300; spec 026 D8, D12; 021 D11, D13): a config or setup file
 * whose bytes differ on the remote is sent again once and compared again,
 * as a proof difference is, so the run goes there. One that stays different
 * after its resend, or that Git ignores here, refuses the remote once,
 * naming the paths and the way out; unrun files stay not run under
 * `not-run`. Each under both loss policies.
 */

const POLICIES: readonly WhenLost[] = ["not-run", "local"];

describe.each(POLICIES)("a config file difference under whenLost %s (row 026-40)", (whenLost) => {
  it("is sent again once and compared again, and the run goes there", async () => {
    const s = await setup({ whenLost });
    // Changed there after its sync, unseen here: as an invalidation the remote missed.
    writeFileSync(join(s.remoteRoot, "vitest.config.ts"), "export default { other: 1 };\n");
    const report = await s.lane.run([REF], background());
    expect(s.logs).toContain(
      "remote box: config and setup files differ at vitest.config.ts; sending again",
    );
    expect(readFileSync(join(s.remoteRoot, "vitest.config.ts"), "utf8")).toBe(
      "export default {};\n",
    );
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localRuns).toHaveLength(0);
    expect(report.failure).toBeNull();
    expect(report.completedFiles).toEqual([REF]);
  });

  it("refuses once, naming the path and the way out, when a resend cannot repair it", async () => {
    const env = { ...ENV, files: [...ENV.files, "setup.cfg"] };
    const s = await setup({ whenLost, remoteEnv: env, localEnv: env });
    // Made there, never by a sync: the resend's removal cannot reach it.
    writeFileSync(join(s.remoteRoot, "setup.cfg"), "made there\n");
    const report = await s.lane.run([REF], background());
    const stayed =
      "config and setup files stayed different after one resend at setup.cfg; something on the remote rewrites them: list the test files that need them in remote.alwaysLocal";
    expect(s.logs.filter((line) => line.includes("sending again"))).toEqual([
      "remote box: config and setup files differ at setup.cfg; sending again",
    ]);
    expect(s.remoteRuns).toEqual([]);
    expect(s.statuses.at(-1)).toContain(stayed);
    if (whenLost === "not-run") {
      expect(s.localRuns).toHaveLength(0);
      expect(report.completedFiles).toEqual([]);
      expect(report.failure).toContain(stayed);
    } else {
      expect(s.localFiles).toEqual([REF.path]);
    }
  });

  it("refuses at once, with no resend, a config file Git ignores here", async () => {
    const s = await setup({
      whenLost,
      files: { ".gitignore": "local.cfg\n", "local.cfg": "here\n" },
      remoteEnv: { ...ENV, files: [...ENV.files, "local.cfg"] },
      localEnv: { ...ENV, files: [...ENV.files, "local.cfg"] },
    });
    await s.lane.run([REF], background());
    expect(s.logs.some((line) => line.includes("sending again"))).toBe(false);
    expect(s.remoteRuns).toEqual([]);
    expect(s.statuses.at(-1)).toContain(
      "config and setup files local.cfg are git-ignored here and never synced to remote; stop ignoring them, or list the test files that need them in remote.alwaysLocal",
    );
  });
});
