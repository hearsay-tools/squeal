import { describe, expect, it } from "vitest";
import { codeSource } from "../../../src/core/delivery/code-source.js";
import { createDelivery } from "../../../src/core/delivery/delivery.js";
import { formatDelta } from "../../../src/core/delivery/format.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import { createStateSink } from "../../../src/core/state/sink.js";
import type { Delta } from "../../../src/core/types/delivery.js";
import {
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putCursor,
  putFile,
  TIERS,
} from "../../code/delivery/helpers.js";
import { open } from "../../code/helpers.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { check, result } from "../../state/helpers.js";
import { NOW } from "../../status/slow-tier-seed.js";
import { wiredRig } from "./rig.js";

/*
 * Spec 015 D6, D7 with 017 D8 "At Stop" (row 017-23): a Stop tells code
 * changes only beside other news, and a lint change is now such news. A
 * Stop whose news is lint alone tells a code change beside it, once; a Stop
 * with a code change alone still tells nothing; with lint off the Stop
 * says what it said before.
 */

const SELECT = fnCheck("selectTier");
const B_FAILS = "FAIL lint: src/b.js: 1 finding, +1 no-console (no-console found)";
const lines = (delta: Delta | null) =>
  (delta === null ? "" : formatDelta(delta, "squeal", undefined, "full")).split("\n");
const isCode = (line: string) => line.startsWith("FAIL complexity: selectTier (");

/** The wiring rig with complexity on and `selectTier` counted under the threshold at revision 1. */
async function rig(lint: boolean) {
  const r = await wiredRig(
    { "src/b.js": "ok\n" },
    { policy: { lint: { enabled: lint }, complexity: { enabled: true } } },
  );
  const wt = r.repo.mainId;
  const code = open(r.repo.commonDir);
  putFile(code, wt, TIERS, [fn("selectTier", 18, 120)]);
  code.states.upsertMany([codeState(wt, SELECT, 18)]);
  putCursor(code, wt);
  /** A hook's delivery, with the lint store when `withLint`. */
  const delivery = (withLint = true) =>
    createDelivery(r.store, {
      status: fixedStatus(),
      now: () => NOW,
      code: codeSource(r.repo.commonDir, r.repo.main),
      ...(withLint ? { lint: lintStoreSource(r.repo.commonDir, r.repo.main) } : {}),
    });
  /** The code pass after the edit at `revision`: `selectTier` went over the threshold. */
  const overThreshold = (revision: number) => {
    putFile(code, wt, TIERS, [fn("selectTier", 23, 120)], { revision });
    code.states.upsertMany([codeState(wt, SELECT, 23, { revision })]);
    putCursor(code, wt, revision);
    code.transitions.append([
      // After the registration seeded the view at `NOW`.
      codeTransition(wt, SELECT, "pass-to-fail", { from: 18, to: 23, at: NOW + 1_000, revision }),
    ]);
  };
  return { ...r, delivery, overThreshold };
}

describe("code changes beside lint news at Stop (015 D7, 017 D8)", () => {
  it("tells a code change beside a Stop's lint news, both once", async () => {
    const r = await rig(true);
    const delivery = r.delivery();
    const me = r.consumer();
    await delivery.register(me);
    const revision = await r.edit({ "src/b.js": "bad no-console\n" });
    r.overThreshold(revision);
    const told = lines(await delivery.onToolBoundary(me, { stop: true }));
    expect(told).toContain(B_FAILS);
    expect(told.filter(isCode)).toHaveLength(1);
    expect(await delivery.onToolBoundary(me, { stop: true })).toBeNull();
    expect(await delivery.onToolBoundary(me)).toBeNull();
  });

  it("still tells nothing at a Stop whose only change is code's", async () => {
    const r = await rig(true);
    const delivery = r.delivery();
    const me = r.consumer();
    await delivery.register(me);
    const revision = await r.edit({ "src/b.js": "ok\n" });
    r.overThreshold(revision);
    expect(await delivery.onToolBoundary(me, { stop: true })).toBeNull();
    // The next tool boundary tells it.
    expect(lines(await delivery.onToolBoundary(me)).filter(isCode)).toHaveLength(1);
  });

  it("with lint off, says at Stop what a delivery without lint says", async () => {
    const r = await rig(false);
    const [withSource, without] = [r.delivery(true), r.delivery(false)];
    const [a, b] = [r.consumer("a"), r.consumer("b")];
    await withSource.register(a);
    await without.register(b);
    // The lint store holds a new finding, but the policy is off: no news, no code beside it.
    const revision = await r.edit({ "src/b.js": "bad no-console\n" });
    r.overThreshold(revision);
    expect(await withSource.onToolBoundary(a, { stop: true })).toBeNull();
    expect(await without.onToolBoundary(b, { stop: true })).toBeNull();
    // A test change: the code change rides beside it, alike in both.
    const file = { project: "", path: "src/a.test.ts" };
    createStateSink(r.store, { now: () => NOW }).applyResults(
      r.repo.mainId,
      revision,
      [result(check("adds", file), "fail", { key: "key-src/a.test.ts" })],
      { checkpointId: null },
    );
    const told = lines(await withSource.onToolBoundary(a, { stop: true }));
    expect(told.filter(isCode)).toHaveLength(1);
    expect(told.some((l) => l.includes("lint"))).toBe(false);
    expect(told).toEqual(lines(await without.onToolBoundary(b, { stop: true })));
  });
});
