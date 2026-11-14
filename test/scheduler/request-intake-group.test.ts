import { describe, expect, it } from "vitest";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import { groupRequest } from "../../src/core/scheduler/request-intake-requests.js";
import { SLOW_GROUP, TESTS_GROUP } from "../../src/core/types/scheduler.js";
import { probeHost } from "./request-intake-probe.js";

/*
 * The real group request's rows of the request intake's table
 * (`request-intake.test.ts`), through `RequestIntake.take` over the probe's
 * real store and ledger (`request-intake-probe.ts`).
 */

describe("request intake: the group request's install-wait answer (row 011-324)", () => {
  // Research `request-intake.md`, difference 3: the answer said only `queued: 0`.
  it.each([AWAITING_INSTALL_REASON, REINSTALLED_REASON])(
    "names the reason (%s), queues nothing and wakes nothing",
    async (reason) => {
      const p = probeHost({ queued: false });
      p.state.waiting = reason;
      const answer = await p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined));
      expect(answer).toEqual({
        revision: p.ledger.revision.number,
        queued: 0,
        coveredId: expect.any(String),
        installWait: reason,
      });
      expect(p.log).toEqual(["pump"]);
    },
  );

  it("names it for run --slow's group too, and for no group the policy lacks", async () => {
    const p = probeHost();
    p.state.waiting = AWAITING_INSTALL_REASON;
    const slow = await p.intake.take(groupRequest(SLOW_GROUP, p.groups, undefined));
    expect(slow).toMatchObject({ queued: 0, installWait: AWAITING_INSTALL_REASON });
    expect(await p.intake.take(groupRequest("e2e", p.groups, undefined))).toBeNull();
  });

  it("is absent once no install is awaited", async () => {
    const p = probeHost();
    const answer = await p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined));
    expect(answer).toMatchObject({ queued: 1 });
    expect(answer).not.toHaveProperty("installWait");
  });
});
