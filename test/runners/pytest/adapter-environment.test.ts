import { describe, expect, it } from "vitest";
import type { PytestProject } from "../../../src/core/types/index.js";
import {
  type AdapterEnvironment,
  admit,
  type Clock,
  SETTLE_LIMIT_MS,
  SETTLE_MS,
} from "../../../src/runners/pytest/adapter-environment.js";

/*
 * Review wave 2, B2: D2's admission under a controlled clock. A ready
 * environment is admitted only once its fingerprint held still for a
 * second and a fresh read finds it there; still moving at 20 s it is
 * `unsettled`, never ready. One without pytest is read again until pytest
 * lands or the same limit passes (task 007-39).
 */

const PROJECT: PytestProject = { name: "small", args: [], env: {}, include: [] };

/** An environment whose fingerprint `tick` may move at each simulated poll. */
function scene(
  tick: (
    now: number,
    env: { fingerprint: string; state: AdapterEnvironment["state"] },
  ) => void = () => {},
) {
  let now = 0;
  const env = { fingerprint: "a", state: "ready" as AdapterEnvironment["state"] };
  let reads = 0;
  const clock: Clock = {
    now: () => now,
    async sleep(ms) {
      now += ms;
      tick(now, env);
    },
  };
  const read = async () => {
    reads += 1;
    return (
      env.state === "ready"
        ? { state: "ready", fingerprint: env.fingerprint, hash: `h-${env.fingerprint}` }
        : { state: env.state, note: "not ready" }
    ) as AdapterEnvironment;
  };
  const run = () => admit(PROJECT, read, () => env.fingerprint, clock);
  return { run, env, now: () => now, reads: () => reads };
}

describe("admit (spec 007 D2, review wave 2 B2)", () => {
  it("at startup admits a still environment only after a second, at the fingerprint it held", async () => {
    const s = scene();
    const admission = await s.run();
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: "a" });
    expect(admission.environment).toMatchObject({ state: "ready", fingerprint: "a" });
    expect(s.now()).toBeGreaterThanOrEqual(SETTLE_MS);
    expect(s.now()).toBeLessThan(SETTLE_MS + 400);
    // The read that admits it comes after the quiet second, not before.
    expect(s.reads()).toBe(2);
  });

  it("a change while settling restarts the second from the change", async () => {
    const s = scene((now, env) => {
      if (now === 600) env.fingerprint = "b";
    });
    const admission = await s.run();
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: "b" });
    expect(admission.environment).toMatchObject({ fingerprint: "b", hash: "h-b" });
    expect(s.now()).toBeGreaterThanOrEqual(600 + SETTLE_MS);
  });

  it("a change at the last poll before the admitting read is not admitted at the old fingerprint", async () => {
    const s = scene((now, env) => {
      if (now === SETTLE_MS) env.fingerprint = "b";
    });
    const admission = await s.run();
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: "b" });
    expect(s.now()).toBeGreaterThanOrEqual(2 * SETTLE_MS);
  });

  it("a change between the quiet second and the admitting read settles again", async () => {
    let fingerprint = "a";
    let calls = 0;
    const read = async () => {
      calls += 1;
      // The second read, the one that would admit, finds the environment moved.
      if (calls === 2) fingerprint = "b";
      return { state: "ready", fingerprint } as AdapterEnvironment;
    };
    let now = 0;
    const clock: Clock = {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    };
    const admission = await admit(PROJECT, read, () => fingerprint, clock);
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: "b" });
    expect(calls).toBe(3);
    expect(now).toBeGreaterThanOrEqual(2 * SETTLE_MS);
  });

  it("changes through the 20 s limit time out unsettled, never ready", async () => {
    let n = 0;
    const s = scene((_now, env) => {
      n += 1;
      env.fingerprint = `f${n}`;
    });
    const admission = await s.run();
    expect(admission.outcome).toBe("timeout");
    expect(admission.fingerprint).toBeNull();
    expect(admission.environment.state).toBe("unsettled");
    expect(admission.environment).toMatchObject({
      note: expect.stringMatching(/kept changing for 20 s.*unknown/),
    });
    expect(s.now()).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
    expect(s.now()).toBeLessThan(SETTLE_LIMIT_MS + 400);
  });

  it.each(["none", "editable-outside"] as const)(
    "the %s state is returned as read, at once",
    async (state) => {
      const s = scene();
      s.env.state = state;
      const admission = await s.run();
      expect(admission).toMatchObject({ outcome: "stable", fingerprint: null });
      expect(admission.environment.state).toBe(state);
      expect(s.now()).toBe(0);
    },
  );

  // Task 007-39, lessons.md defect 8: pyvenv.cfg comes first, pytest with the packages after it.
  it("an environment without pytest is read again until pytest lands, then settles", async () => {
    const s = scene((now, env) => {
      if (now === 600) env.state = "ready";
    });
    s.env.state = "no-pytest";
    const admission = await s.run();
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: "a" });
    expect(s.now()).toBeGreaterThanOrEqual(600 + SETTLE_MS);
    expect(s.now()).toBeLessThan(600 + SETTLE_MS + 400);
  });

  it("an environment without pytest through the 20 s limit is no-pytest", async () => {
    const s = scene();
    s.env.state = "no-pytest";
    const admission = await s.run();
    expect(admission).toMatchObject({ outcome: "stable", fingerprint: null });
    expect(admission.environment.state).toBe("no-pytest");
    expect(s.now()).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
    expect(s.now()).toBeLessThan(SETTLE_LIMIT_MS + 400);
  });
});
