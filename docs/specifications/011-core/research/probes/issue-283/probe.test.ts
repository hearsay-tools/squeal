import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, expect, it } from "vitest";
import { holderText } from "../../../../../../src/cli/group-pending.js";
import { groupRequests, requestGroup } from "../../../../../../src/core/daemon/run-group.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import { Gate } from "../../../../../../test/scheduler/batch-fixture.js";
import { catchUpRepo, catchUpSide } from "../../../../../../test/scheduler/catch-up-fixture.js";

const evidence: unknown[] = [];
afterAll(() => writeFileSync(new URL("./result.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`));

// Throwaway mechanism probe: real scheduler/store, two fake test files, no real runner.
it.each(["invalidate", "testFiles"] as const)("an existing edited named test waits for held %s", async (heldMethod) => {
  const target = "test/target.test.ts";
  const files = [
    { path: target, ms: 10, imports: ["src/target.ts"] },
    { path: "test/other.test.ts", ms: 10, imports: ["src/other.ts"] },
  ];
  const gate = new Gate(false);
  let listingCalls = 0;
  let heldCalls = 0;
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 1,
    policy: RUN_MISSING,
    wrapRunner: (runner) => new Proxy(runner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if (prop === "testFiles") listingCalls += 1;
          if (prop === heldMethod) {
            heldCalls += 1;
            await gate.wait();
          }
          return value.apply(target, args);
        };
      },
    }),
  });
  await side.scheduler.start();
  await side.quiet();
  expect(side.current(target)).toBe(true);
  const runsBefore = side.runner.runsOf(target).length;
  const listingsBefore = listingCalls;
  const heldBefore = heldCalls;
  gate.hold();
  try {
    await side.edit("watch", target, ...(heldMethod === "testFiles" ? ["src/new.ts"] : []));
    await expect.poll(() => heldCalls).toBeGreaterThan(heldBefore);
    const requests = groupRequests((group, held, paths) =>
      requestGroup(side.scheduler, group, held, paths), 8);
    const { requestId } = requests.start("tests", [target]);
    await sleep(650);
    const pending = requests.status(requestId);
    expect(pending?.requested).toBeNull();
    expect(pending?.holder?.kind).toBe("listing");
    expect(side.runner.runsOf(target).length).toBe(runsBefore);
    evidence.push({ phase: "held", heldMethod, requested: pending?.requested,
      holder: pending?.holder, text: holderText(pending?.holder ?? null, null),
      extraTargetRuns: side.runner.runsOf(target).length - runsBefore,
      extraListingCalls: listingCalls - listingsBefore });
    gate.stop();
    await expect.poll(() => requests.status(requestId)?.requested).not.toBeNull();
    await side.quiet();
    const accepted = requests.status(requestId);
    expect(accepted?.narrow?.selected.map((file) => file.path)).toEqual([target]);
    expect(side.current(target)).toBe(true);
    expect(side.runner.runsOf(target).length).toBe(runsBefore + 1);
    evidence.push({ phase: "released", heldMethod, requested: accepted?.requested,
      selected: accepted?.narrow?.selected, targetCurrent: side.current(target),
      extraTargetRuns: side.runner.runsOf(target).length - runsBefore });
  } finally {
    gate.stop();
  }
}, 10_000);
