import { describe, expect, it } from "vitest";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { releaseLintGroup } from "../../../src/core/lint/pass/commit-entry.js";
import type { SquealRepo } from "../../harness/helpers.js";
import {
  decision,
  HARNESSES,
  type Harness,
  listenAsDaemon,
  markStopWait,
} from "../../harness/stop-slow-helpers.js";
import { hookedRepo } from "./rig.js";

/*
 * Row 019-45 (spec 019 D1 as amended 2026-11-05, D4; 017 D8): a lint group
 * at `stop`. Its edit waits while the agent works; at Stop the waiting
 * entry asks the daemon to lint it now, waits for it, and holds once to
 * tell its findings. With `lint.blocking` it holds again for a file still
 * failing, up to `stop.maxHolds`. Claude Code and Codex, over the real lint
 * pass and its hold.
 */

const AT_STOP = { name: "lint", lint: true, at: "stop" };
const FAIL_LINE = "FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)";

/**
 * A session in a turn whose edit to `src/a.js` waits for Stop, the waiting
 * entry known, and a daemon whose `run-group` releases the group and runs
 * the pass, as the scheduler's `requestGroup` does.
 */
async function atStop(harness: Harness, lint: object, stop: object) {
  const policy = { checks: [AT_STOP], stop: { slowWaitMs: 5_000, ...stop } };
  const hooked = await hookedRepo({ "src/a.js": "ok\n" }, { enabled: true, ...lint }, policy);
  const { r, tree } = hooked;
  await harness.startTurn(r);
  markStopWait(r, harness.name);
  await hooked.edit({ "src/a.js": "bad no-undef\n" });
  const asked: string[] = [];
  await listenAsDaemon(r.store, r.worktreeId, {
    requestGroup: async (group) => {
      asked.push(group);
      const blobOf = (path: string) => tree.source.file(path)?.hash ?? null;
      const queued = releaseLintGroup(
        r.repo.commonDir,
        readPolicy(r.root),
        r.worktreeId,
        group,
        blobOf,
      );
      void hooked.settle();
      return { revision: r.store.revisions.latest(r.worktreeId)?.number ?? 0, queued };
    },
  });
  return { ...hooked, asked };
}

/** The 2 s Stop entry, then the waiting one, each with `overrides` in its input. */
async function stopPair(harness: Harness, r: SquealRepo, overrides: object = {}) {
  const quick = decision(await harness.stop(r, overrides));
  const waiting = decision(await harness.stopSlow(r, overrides));
  return { quick, waiting };
}

const ACTIVE = { stop_hook_active: true };

describe.each(HARNESSES)("a lint group at stop, $name (019-45)", (harness) => {
  it("Stop asks for the lint, waits for it, and tells its finding once", async () => {
    const { r, asked } = await atStop(harness, {}, {});
    const first = await stopPair(harness, r);
    expect(first.quick, "the 2 s entry leaves the lint to the waiting entry").toEqual({});
    expect(asked).toEqual(["lint"]);
    expect(first.waiting.decision).toBe("block");
    expect(first.waiting.reason).toContain(
      "Squeal policy checks puts the lint group at stop and the lint group ran at revision 2: 1 file has lint findings: src/a.js.",
    );
    expect(first.waiting.reason).toContain(FAIL_LINE);
    // Told once: the next Stop, after Squeal's continuation, says nothing.
    const again = await stopPair(harness, r, ACTIVE);
    expect(again).toEqual({ quick: {}, waiting: {} });
  });

  it("with lint.blocking, holds again for the file still failing, up to stop.maxHolds", async () => {
    const { r } = await atStop(harness, { blocking: true }, { maxHolds: 2 });
    const first = await stopPair(harness, r);
    expect(first.waiting.reason).toContain(FAIL_LINE);
    const second = await stopPair(harness, r, ACTIVE);
    expect(second.quick).toEqual({});
    expect(second.waiting.decision).toBe("block");
    expect(second.waiting.reason).toContain(
      "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/a.js (1 finding).",
    );
    expect(second.waiting.reason).not.toContain(FAIL_LINE);
    // The turn's holds are spent.
    expect(await stopPair(harness, r, ACTIVE)).toEqual({
      quick: {},
      waiting: {},
    });
  });

  it("without the waiting entry known, the 2 s entry holds at once naming the lint check", async () => {
    const policy = { checks: [AT_STOP] };
    const { r, edit } = await hookedRepo({ "src/a.js": "ok\n" }, { enabled: true }, policy);
    await harness.startTurn(r);
    await edit({ "src/a.js": "bad no-undef\n" });
    const out = decision(await harness.stop(r));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(
      "Squeal policy checks puts the lint group at stop and 1 lint check is not linted at revision 2: src/a.js. `squeal run lint --wait` runs them and waits for their results.",
    );
  });
});
