import { describe, expect, it } from "vitest";
import { requestGroup } from "../../src/core/daemon/run-group.js";
import { AtRunRequests, flagAccepted } from "../../src/core/daemon/run-groups-watch.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NarrowRunOptions, Scheduler } from "../../src/core/types/scheduler.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { heldSide } from "./held-side-fixture.js";

/*
 * Row 023-36 (T3; review wave-20 re-review B8): `Daemon.#requestGroup`
 * flags a `status --at --run` request's files after the scheduler's
 * answer, before their first run. Row 023-41 removed the take-back and its
 * test here (a request taken back while the intake held it).
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

describe("an accepted --run request's flag (023-36, B8)", { timeout: 60_000 }, () => {
  it("flags the file of an accepted request, before its first run", async () => {
    const { side, gate } = await heldSide(FILES);
    const requests = new AtRunRequests();
    let flaggedAtRun: boolean | null = null;
    const hold = side.runner.holdOf;
    side.runner.holdOf = (run) => {
      flaggedAtRun ??= requests.flagged([A]);
      return hold?.(run);
    };
    await daemonRequest(side.scheduler, requests, { at: true });
    expect(requests.flagged([A])).toBe(true);
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    gate.stop();
    expect(flaggedAtRun).toBe(true);
  });
});
