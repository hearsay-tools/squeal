import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup, until } from "./lane-fixture.js";

/*
 * Review 0.1.616 B7 (spec 026 D12.4): a lane's sleep closes the remote's
 * channel before the machine is asked to sleep, refuses while a run is on
 * the remote, and the next background run connects again. S2: a lane that
 * is not eager connects at its first background run, not when it is made.
 */

describe("a remote lane's sleep (review 0.1.616 B7)", () => {
  it("closes the channel strictly before the machine sleeps, and the next run connects again", async () => {
    const s = await setup();
    await s.lane.run([REF], background());
    expect(s.events).toEqual(["connect"]);
    const outcome = await s.lane.sleep(async () => {
      s.events.push("sleep");
    });
    expect(outcome).toBe("slept");
    expect(s.events).toEqual(["connect", "close", "sleep"]);
    expect(s.statuses.at(-1)).toBe("remote box: asleep; the next background run wakes it");
    // The run after the sleep: the lane connects again (the daemon's connect wakes the machine).
    await s.lane.run([REF], background());
    await until(() => s.statuses.at(-1)?.includes(" go there") === true);
    expect(s.events).toEqual(["connect", "close", "sleep", "connect"]);
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(2);
  });

  it("refuses while a run is on the remote, and closes nothing", async () => {
    let finish = () => {};
    const s = await setup({
      remoteRun: () =>
        new Promise((resolve) => {
          finish = () => resolve(REPORT);
        }),
    });
    const running = s.lane.run([REF], background());
    await until(() => s.remoteRuns.length === 1);
    let slept = false;
    const outcome = await s.lane.sleep(async () => {
      slept = true;
    });
    expect(outcome).toEqual({ busy: "a run is on remote box" });
    expect(slept).toBe(false);
    expect(s.events).toEqual(["connect"]);
    finish();
    await running;
    expect(await s.lane.sleep(async () => {})).toBe("slept");
  });

  it("runs no tier remotely while the machine is being put to sleep", async () => {
    const s = await setup();
    const wake: (() => void)[] = [];
    const going = s.lane.sleep(() => new Promise<void>((resolve) => wake.push(resolve)));
    await until(() => wake.length === 1);
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([]);
    expect(s.localRuns).toHaveLength(1);
    expect(s.events).toEqual(["connect", "close"]);
    wake[0]?.();
    expect(await going).toBe("slept");
  });
});

describe("a lane that is not eager (review 0.1.616 S2)", () => {
  it("connects at its first background run, not when it is made", async () => {
    const s = await setup({ eager: false });
    await sleep(100);
    expect(s.connects).toEqual([]);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(1);
  });
});
