import { describe, expect, it } from "vitest";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { narrowRequest, REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import { NO_PASS } from "../../src/core/scheduler/request-intake.js";
import { groupRequest } from "../../src/core/scheduler/request-intake-requests.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { SLOW_GROUP, TESTS_GROUP } from "../../src/core/types/scheduler.js";
import { C, keyOf, NOTHING, type Probe, probeHost } from "./request-intake-probe.js";

/*
 * The real group and narrow requests' rows of the request intake's table
 * (`request-intake.test.ts`), through `RequestIntake.take` over the probe's
 * real store and ledger (`request-intake-probe.ts`).
 */

/** Each request as a command sends it; `C` is a file of group `tests`. */
const REQUESTS = [
  ["run <group>", (p: Probe) => p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined))],
  [
    "run <group> <path>",
    (p: Probe) => p.intake.take(narrowRequest(TESTS_GROUP, [C.path], p.groups)),
  ],
] as const;

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
      expect(p.log).toEqual(["pass", "pump"]);
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

/*
 * Row 011-335 (research `group-wait-edits.md`, F1): the probe's order. `C`
 * is current; an edit moves its key, and the request reaches the daemon
 * before the change feed stored the edit. The request is taken only after a
 * pass that started after it, as `run --all` is (row 011-198).
 */
describe("request intake: the group and narrow requests wait for a pass (row 011-335)", () => {
  /** `C` current at its key; the next pass stores the edit to it; the edit's revision. */
  function editBeforeRequest(p: Probe): number {
    p.ledger.addFile(C);
    p.ledger.settle([C], NOTHING);
    const c = p.ledger.file(C);
    if (c === undefined) throw new Error("C is not listed");
    p.ledger.applyResults(c, keyOf(C), [], null);
    p.ledger.commit();
    const edit = p.ledger.revision.number + 1;
    p.state.stores = () => {
      p.state.keys.set(C.path, "f".repeat(64) as CheckKey);
      p.ledger.revision = { ...p.ledger.revision, number: edit as never };
      p.ledger.settle([C], NOTHING);
      p.ledger.commit();
    };
    return edit;
  }

  it.each(REQUESTS)("%s: taken at the edit's revision, the edited file queued", async (_, take) => {
    const p = probeHost();
    const edit = editBeforeRequest(p);
    const answer = await take(p);
    expect(answer).toMatchObject({ revision: edit });
    expect(p.ledger.file(C)?.phase).toBe("queued");
    expect(p.log[0]).toBe("pass");
  });

  it.each(REQUESTS)(
    "%s: no pass delivered after it rejects with NO_PASS, and takes nothing",
    async (_, take) => {
      const p = probeHost();
      p.state.delivered = 1;
      await expect(take(p)).rejects.toThrow(NO_PASS);
      expect(p.log).toEqual(["pass"]);
    },
  );
});
