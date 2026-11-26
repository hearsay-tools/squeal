import { describe, expect, it } from "vitest";
import { holderText } from "../../src/cli/group-pending.js";
import { groupRequests, type HeldBy, requestGroup } from "../../src/core/daemon/run-group.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { Gate } from "../scheduler/batch-fixture.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";

/*
 * Row 011-397 (W3's finding on `research/stuck-running.md` shape 2 (d)): a
 * `run-group` request that waits while a revision is listed read "what
 * holds it is unknown", since the listing's runner phase runs with the
 * scheduler's lock free. The holder is now `listing`, with the revision.
 */

const TARGET = "test/target.test.ts";
const FILES: readonly CatchUpFile[] = [
  { path: TARGET, ms: 10, imports: ["src/shared.ts"] },
  { path: "test/other.test.ts", ms: 10, imports: ["src/shared.ts"] },
];

/** `runner` whose calls other than `run` wait on `gate`, as a long listing's runner part. */
function heldListing(runner: RunnerAdapter, gate: Gate): RunnerAdapter {
  return new Proxy(runner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || prop === "run") return value;
      return async (...args: unknown[]) => {
        await gate.wait();
        return value.apply(target, args);
      };
    },
  });
}

describe("a run-group request taken during a listing (row 011-397)", { timeout: 60_000 }, () => {
  it("names the listing and its revision while it waits, then is taken", async () => {
    const repo = catchUpRepo(FILES);
    const gate = new Gate(false);
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 4,
      policy: RUN_MISSING,
      wrapRunner: (runner) => heldListing(runner, gate),
    });
    await side.scheduler.start();
    await side.quiet();
    gate.hold();
    await side.edit("watch", "src/shared.ts");
    await expect.poll(() => side.scheduler.listing?.() ?? null).not.toBeNull();
    const revision = side.scheduler.listing?.();
    const told: HeldBy[] = [];
    const taken = requestGroup(side.scheduler, "tests", (holder) => told.push(holder), [TARGET]);
    await expect
      .poll(() => told.at(-1))
      .toEqual({ kind: "listing", revision, stage: "invalidating" });
    gate.stop();
    await expect(taken).resolves.toMatchObject({ narrow: { selected: [{ path: TARGET }] } });
    expect(side.scheduler.listing?.()).toBeNull();
  });

  it("the socket's answer and the CLI's words name it", () => {
    let tell: (holder: HeldBy) => void = () => {};
    const groups = groupRequests((_group, held) => {
      tell = held;
      return new Promise(() => {});
    }, 8);
    const { requestId } = groups.start("tests", [TARGET as never]);
    tell({ kind: "listing", revision: 7 });
    const holder = groups.status(requestId)?.holder;
    expect(holder).toEqual({ kind: "listing", revision: 7, step: null });
    expect(holderText(holder, null)).toBe("it waits while Squeal lists revision 7");
  });
});
