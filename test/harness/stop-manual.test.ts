import { describe, expect, it } from "vitest";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { PolicyFile } from "../../src/core/types/policy.js";
import {
  decision,
  HARNESSES,
  listenAsDaemon,
  repo,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Row 019-47 (spec 019 D1, D4): Stop requires a group at `manual` at
 * neither entry. With its test file queued and lint on, the 2 s entry and
 * the waiting entry end the turn at once, and neither asks the daemon to
 * run it; with the waiting entry not known yet, the 2 s entry does not
 * hold for it either. Claude Code and Codex alike.
 */

/** The fixture's queued slow file, `test/e2e/slow.test.ts`, in a group at `manual`. */
const PARITY: CheckGroup = {
  name: "parity",
  runner: "vitest",
  tests: ["test/e2e/**"],
  at: "manual",
};
const POLICY: PolicyFile = {
  lint: { enabled: true },
  checks: [PARITY, { name: "slowlint", lint: true, at: "manual" }],
  stop: { slowWaitMs: 2_000 },
};

describe.each(HARNESSES)("Stop and a group at manual, $name (019-47)", (harness) => {
  it("ends the turn at once at both entries and asks the daemon to run nothing", async () => {
    const r = await repo(harness, {});
    r.policy(POLICY);
    const asked: string[] = [];
    await listenAsDaemon(r.store, r.worktreeId, {
      requestSlowSuite: async () => {
        asked.push("run-slow");
        return { revision: 1, queued: 1 };
      },
      requestGroup: async (group) => {
        asked.push(group);
        return { revision: 1, queued: 1 };
      },
    });
    const started = performance.now();
    expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(asked).toEqual([]);
    expect(turnOf(r)).toBe("idle");
  });

  it("without the waiting entry known, the 2 s entry does not hold for it", async () => {
    const r = await repo(harness, {}, false);
    r.policy(POLICY);
    expect(decision(await harness.stop(r))).toEqual({});
    expect(turnOf(r)).toBe("idle");
  });
});
