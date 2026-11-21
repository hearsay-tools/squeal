import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { requestGroup } from "../../src/core/daemon/run-group.js";
import { AtRunRequests, flagAccepted } from "../../src/core/daemon/run-groups-watch.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NarrowRunOptions, Scheduler } from "../../src/core/types/scheduler.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { ranPaths } from "./group-lanes-fixture.js";
import { heldSide } from "./take-back-fixture.js";

/*
 * Row 023-36 (T3; review wave-20 re-review B8): a `status --at --run`
 * request whose call takes it back while the scheduler's intake still
 * holds it flags nothing when the intake ends, so a later ordinary run of
 * its file is not marked. The daemon's order (`Daemon.#requestTakeBack`):
 * the flags first, then the scheduler; and `#requestGroup` flags after the
 * scheduler's answer. A request that is not taken back is the control.
 */

const FILES: readonly CatchUpFile[] = [
  { path: "test/browser/a.test.ts", ms: 10, imports: ["src/core.ts"] },
];
const A: TestFileRef = { project: "", path: "test/browser/a.test.ts" };

/** `Daemon.#requestGroup`'s order: the scheduler's answer, then the flags. */
async function daemonRequest(
  scheduler: Scheduler,
  requests: AtRunRequests,
  options: NarrowRunOptions,
): Promise<void> {
  const requested = await requestGroup(scheduler, "browser", undefined, ["src/core.ts"], options);
  flagAccepted(requests, requested, options);
}

describe("a taken-back --run request's late answer (023-36, B8)", { timeout: 60_000 }, () => {
  it("flags nothing when the take-back came while the intake waited", async () => {
    const { side, gate } = await heldSide(FILES);
    gate.stop();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = false;
    const affected = side.runner.affected;
    side.runner.affected = async (changed) => {
      asked = true;
      await held;
      return affected(changed);
    };
    const requests = new AtRunRequests();
    const request = daemonRequest(side.scheduler, requests, { owner: "late", at: true });
    await expect.poll(() => asked, { timeout: 20_000 }).toBe(true);
    // `Daemon.#requestTakeBack`: the flags, then the scheduler.
    requests.takenBack(["late"]);
    const back = side.scheduler.takeBack?.(["late"]);
    release();
    await request;
    await expect(back).resolves.toEqual({ takenBack: 0, running: 0, kept: 0 });
    await side.rest();
    await delay(300);
    expect(ranPaths(side)).toEqual([]);
    expect(requests.flagged([A])).toBe(false);
  });

  it("flags the file of a request not taken back, before its first run", async () => {
    const { side, gate } = await heldSide(FILES);
    const requests = new AtRunRequests();
    let flaggedAtRun: boolean | null = null;
    const hold = side.runner.holdOf;
    side.runner.holdOf = (run) => {
      flaggedAtRun ??= requests.flagged([A]);
      return hold?.(run);
    };
    await daemonRequest(side.scheduler, requests, { owner: "kept", at: true });
    expect(requests.flagged([A])).toBe(true);
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    gate.stop();
    expect(flaggedAtRun).toBe(true);
  });
});
