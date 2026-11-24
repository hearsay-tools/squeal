import { describe, expect, it } from "vitest";
import { goesRemote, remoteTierOf } from "../../../src/core/runner-host/remote/lane-tiers.js";
import type { RemoteTier } from "../../../src/core/runner-host/remote/settings.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, options, REF, setup, until } from "./lane-fixture.js";

/*
 * Spec 026 D8.1 (row 026-11): each tier of `remote.json`'s `lanes` goes to
 * the remote; 021 D12's default, `background`, sends nothing else. A beside
 * tier goes with `edit`. A lane made per pass of a slow lane runs here in its
 * own instance, plans with the runner's, and waits for its connect.
 */

const EDIT = options({ lane: "vitest" });
const SLOW = options({ lane: "slow:vitest" });
const GROUP = options({ lane: "group:e2e:vitest" });
const BESIDE = options({ lane: "beside:vitest" });
const BACKGROUND = background();

describe("a run's tier (row 026-11)", () => {
  it("names each lane's tier", () => {
    expect(remoteTierOf(EDIT)).toBe("edit");
    expect(remoteTierOf(options())).toBe("edit");
    expect(remoteTierOf(SLOW)).toBe("slow");
    expect(remoteTierOf(GROUP)).toBe("group");
    expect(remoteTierOf(BESIDE)).toBe("edit");
    expect(remoteTierOf(BACKGROUND)).toBe("background");
    // A slow lane's run is never a background one, but its lane decides first.
    expect(remoteTierOf(background({ lane: "slow:vitest" }))).toBe("slow");
  });

  it("keeps 021's default: a background tier in the runner's own lane alone", () => {
    const remote = [EDIT, SLOW, GROUP, BESIDE, BACKGROUND].filter((run) => goesRemote(run));
    expect(remote).toEqual([BACKGROUND]);
  });

  it("sends each configured tier, and a beside tier with edit", () => {
    const sent = (tiers: RemoteTier[]) =>
      [EDIT, SLOW, GROUP, BESIDE, BACKGROUND].filter((run) => goesRemote(run, tiers));
    expect(sent(["edit"])).toEqual([EDIT, BESIDE]);
    expect(sent(["slow"])).toEqual([SLOW]);
    expect(sent(["group"])).toEqual([GROUP]);
    expect(sent(["background", "edit", "slow", "group"])).toEqual([
      EDIT,
      SLOW,
      GROUP,
      BESIDE,
      BACKGROUND,
    ]);
  });
});

describe("a remote lane of several tiers (row 026-11)", () => {
  it("runs edit tiers there when edit is configured, and names the tiers", async () => {
    const s = await setup({ lanes: ["edit", "background"] });
    expect(s.statuses.at(-1)).toMatch(/edit and background runs of vitest go there/);
    await s.lane.run([REF], options({ lane: "vitest" }));
    await s.lane.run([REF], background());
    await s.lane.run([REF], options({ lane: "slow:vitest" }));
    expect(s.remoteRuns).toHaveLength(2);
    expect(s.localRuns).toHaveLength(1);
    expect(s.localRuns[0]?.lane).toBe("slow:vitest");
  });

  it("per pass of a slow lane: waits for its connect, runs there, and closes only its own instance", async () => {
    const own: string[] = [];
    const instance = (base: RunnerAdapter): RunnerAdapter => ({
      ...base,
      run: async (files, run) => {
        own.push(`run ${run.lane}`);
        return base.run(files, run);
      },
      invalidate: async (paths) => {
        own.push(`invalidate ${paths.map((p) => p.path).join(",")}`);
        return { recreatedProjects: [] };
      },
      close: async () => {
        own.push("close");
      },
    });
    const s = await setup({ lanes: ["slow"], eager: false, awaitConnect: true, here: instance });
    expect(s.connects).toEqual([]);
    const report = await s.lane.run([REF], options({ lane: "slow:vitest" }));
    expect(report.end).toBe("completed");
    expect(s.connects).toHaveLength(1);
    expect(s.remoteRuns).toEqual(["test/a.test.ts"]);
    // An edit tier is not this lane's: it runs here, in the lane's own instance.
    await s.lane.run([REF], options({ lane: "vitest" }));
    expect(own).toEqual(["run vitest"]);
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    await s.lane.close();
    expect(own).toEqual(["run vitest", "invalidate src/a.ts", "close"]);
    expect(s.localCloses()).toBe(0);
  });

  it("is busy while a connect or a remote run is in flight, and marks its activity", async () => {
    let finish = () => {};
    const s = await setup({
      remoteRun: () =>
        new Promise((resolve) => {
          finish = () => resolve({ ...REPORT, completedFiles: [REF] });
        }),
    });
    expect(s.lane.busy()).toBeNull();
    const marks = s.activity.length;
    const running = s.lane.run([REF], background());
    await until(() => s.remoteRuns.length === 1);
    expect(s.lane.busy()).toBe("a run is on remote box");
    finish();
    await running;
    expect(s.lane.busy()).toBeNull();
    expect(s.activity.length).toBe(marks + 2);
  });
});
