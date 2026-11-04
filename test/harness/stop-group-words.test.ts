import { describe, expect, it } from "vitest";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  type PolicyFile,
  refinedMetaKey,
  type TestFileRef,
} from "../../src/core/types/index.js";
import type { SquealRepo } from "./helpers.js";
import {
  decision,
  HARNESSES,
  landSlow,
  repo,
  stopBoth,
  stopThenWait,
} from "./stop-slow-helpers.js";

/*
 * Row 019-23 (spec 019 D4's last paragraph, D6): Stop's block and hold
 * texts for a configured group at `stop` name the group and `squeal run
 * <group> --wait`; the default `slow` group keeps today's words
 * (`stop.requireSlowSuite`, `run --slow --wait`). The Stop's status text
 * carries the group's line, ending in how long Stop waits for it. Claude
 * Code and Codex alike.
 */

/** A configured group of the fixture's slow file, at `stop`, with no `slow` key marking it. */
const E2E: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };

/** A file the default `slow` group owns beside the e2e group's. */
const HEAVY: TestFileRef = { project: "", path: "test/heavy/load.test.ts" };

/** The CLI as either harness names it in a command: `squeal` or a path ending in it. */
const CLI = "`[^`]*squeal[^`]*";

/** `repo`'s fixture (revision 1, the slow file queued, the waiting entry known) under `policy`. */
async function withPolicy(
  harness: (typeof HARNESSES)[number],
  policy: PolicyFile,
  marked = true,
): Promise<SquealRepo> {
  const r = await repo(harness, {}, marked);
  r.policy(policy);
  return r;
}

describe.each(HARNESSES)("Stop's words for a configured group, $name (019 D4, D6)", (harness) => {
  it("the 2 s entry's block names the group and `run e2e --wait`", async () => {
    const r = await withPolicy(harness, { checks: [E2E] }, false);
    const out = decision(await harness.stop(r));
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(
      new RegExp(
        "^Squeal policy checks puts the e2e group at stop and 1 e2e test file is not current " +
          `at revision 1: test/e2e/slow\\.test\\.ts\\. ${CLI} run e2e --wait\` runs them and ` +
          "waits for their results\\.\n",
      ),
    );
    expect(out.reason).not.toContain("requireSlowSuite");
    expect(out.reason).not.toContain("--slow");
  });

  it("the block's status text has the group's line, with Stop's wait (D6)", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 300_000 } }, false);
    const out = decision(await harness.stop(r));
    expect(out.reason).toMatch(
      new RegExp(
        "\ne2e: 1 test file; 1 pending\\. Squeal runs them when the agent pauses, and Stop " +
          "waits up to 5 min for them; " +
          `${CLI} run e2e --wait 60000\` runs it now and waits for its result\\.(\n|$)`,
      ),
    );
    expect(out.reason).not.toContain("Slow tier:");
  });

  it("the waiting entry's block at the bound names the group and `run e2e --wait`", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 300 } });
    const out = await stopThenWait(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting.reason).toMatch(
      new RegExp(
        "^Squeal policy checks puts the e2e group at stop and after 0\\.3 s 1 e2e test file " +
          "is still not current at revision 1: test/e2e/slow\\.test\\.ts\\. " +
          `${CLI} run e2e --wait\` waits for their results\\.\n`,
      ),
    );
  });

  it("the waiting entry's block on a failure names the group that ran", async () => {
    const r = await withPolicy(harness, { checks: [E2E] });
    const out = await stopBoth(harness, r, () => landSlow(r, "fail"));
    expect(out.quick).toEqual({});
    // Row 019-30 (P6): at the default `maxHolds` 1 the hold is the turn's last, and says so.
    expect(out.waiting.reason).toMatch(
      new RegExp(
        "^Squeal policy checks puts the e2e group at stop and the e2e group ran at revision 1: " +
          "1 check fails: test/e2e/slow\\.test\\.ts > ledger > posts\\.\n" +
          "This is Stop's last hold this turn: no later Stop in it waits for the e2e group, and " +
          `${CLI} run e2e --wait\` runs it and waits for its results\\.\n\n`,
      ),
    );
  });

  it("with only the runner part pending, the bound names the group's files not listed yet", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 400 } });
    landSlow(r, "pass");
    r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    const out = await stopThenWait(harness, r);
    expect(out.waiting.reason).toMatch(
      new RegExp(
        "^Squeal policy checks puts the e2e group at stop and after 0\\.4 s the runner part " +
          "of revision 1 is still pending: e2e test files it adds are not listed yet\\. " +
          `${CLI} run e2e --wait\` waits for their results\\.\n`,
      ),
    );
  });

  it("names each group on its own line, the default slow group in today's words", async () => {
    const r = await withPolicy(
      harness,
      {
        checks: [E2E],
        slow: { ...DEFAULT_POLICY.slow, include: ["test/heavy/**"] },
        stop: { requireSlowSuite: true },
      },
      false,
    );
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: HEAVY, key: "heavy1", revision: 1, pending: "queued" },
    ]);
    const out = decision(await harness.stop(r));
    const lines = (out.reason ?? "").split("\n\n")[0]?.split("\n") ?? [];
    expect(lines).toHaveLength(3);
    // Row 019-30 (P6): the turn's last hold names both groups' commands on a line after theirs.
    expect(lines[2]).toMatch(
      /^This is Stop's last hold this turn: no later Stop in it waits for (the e2e group and the slow tier|the slow tier and the e2e group), and `.*run (e2e|--slow) --wait` and `.*run (e2e|--slow) --wait` run them and wait for their results\.$/,
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          "^Squeal policy checks puts the e2e group at stop and 1 e2e test file is not " +
            `current at revision 1: test/e2e/slow\\.test\\.ts\\. ${CLI} run e2e --wait\` `,
        ),
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          "^Squeal policy stop\\.requireSlowSuite is on and 1 slow test file is not current " +
            `at revision 1: test/heavy/load\\.test\\.ts\\. ${CLI} run --slow --wait\` runs them `,
        ),
      ),
    );
  });
});
