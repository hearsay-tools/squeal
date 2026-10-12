import { describe, expect, it } from "vitest";
import { refinedMetaKey } from "../../src/core/types/index.js";
import {
  clock,
  HARNESSES,
  landSlow,
  queueSlowAgain,
  repo,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Review wave 13am, B1 and B2 (task 001-295): the waiting Stop entry at its
 * read boundaries. The daemon's writes land from the fixture's own SQLite
 * connection at a chosen call of the entry's clock (`clock`), as the
 * daemon commits while a hook's poll holds its older snapshot.
 *
 * B1: a slow failure that landed after the 2 s entry's silent end is decided,
 * even before the waiting entry's first read. B2: completion is
 * accepted at the live revision only, and never while the runner part of
 * the revision is pending.
 */

const FAILS =
  /^Squeal policy stop.requireSlowSuite is on and the slow tier ran at revision 1: 1 check fails: test\/e2e\/slow.test.ts > ledger > posts\.\n\n/;

describe.each(HARNESSES)("the waiting Stop at its read boundaries, $name (13am)", (harness) => {
  it("B1: blocks on a slow failure that landed between the two entries", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const out = await stopThenWait(harness, r, () => landSlow(r, "fail"));
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(FAILS);
    expect(out.waiting.reason).toContain("expected 1 to be 2");
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B1 control: a pass that landed between the two entries stays silent", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const out = await stopThenWait(harness, r, () => landSlow(r, "pass"));
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B1: blocks on a slow failure that landed while its first read held the file open", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const at = clock({ 2: () => landSlow(r, "fail") });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(FAILS);
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B1 control: a pass that landed during its first read stays silent", async () => {
    const r = await repo(harness, { requireSlowSuite: true });
    const at = clock({ 2: () => landSlow(r, "pass") });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B2: a newer revision that queues the slow file during the read that saw it pass is waited for", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 600 });
    const at = clock({ 3: () => landSlow(r, "pass"), 4: () => queueSlowAgain(r) });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(r.store.revisions.latest(r.worktreeId)?.number).toBe(2);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 0.6 s 1 slow test file is still not current at revision 2: test\/e2e\/slow.test.ts\./,
    );
    expect(out.waiting.reason).toContain("SQUEAL · status at revision 2");
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B2: a newer revision's pass after the move ends the turn silently", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
    const landed = setTimeout(() => landSlow(r, "pass", "slow2"), 400);
    try {
      const at = clock({ 3: () => landSlow(r, "pass"), 4: () => queueSlowAgain(r) });
      const out = await stopThenWait(harness, r, () => {}, at);
      expect(out.waiting).toEqual({});
    } finally {
      clearTimeout(landed);
    }
    expect(turnOf(r)).toBe("idle");
  });

  it("B2: a failure seen at an older revision never rides beside a newer header", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 600 });
    const at = clock({ 3: () => landSlow(r, "fail"), 4: () => queueSlowAgain(r) });
    const out = await stopThenWait(harness, r, () => {}, at);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).not.toMatch(/ran at revision 1/);
    expect(out.waiting.reason).toMatch(/still not current at revision 2: test\/e2e\/slow.test.ts/);
  });

  it("B2: an unrefined revision is not complete, and the bound names it pending", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    landSlow(r, "pass");
    r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    const out = await stopThenWait(harness, r, () => {});
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 0.4 s the runner part of revision 1 is still pending: slow test files it adds are not listed yet\. `.*squeal.* run --slow --wait` waits for their results\.\n\n/,
    );
    expect(turnOf(r)).toBe("in-turn");
  });

  it("B2 control: a refined revision whose slow files passed stays silent", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    landSlow(r, "pass");
    r.store.meta.set(refinedMetaKey(r.worktreeId), "1");
    const out = await stopThenWait(harness, r, () => {});
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("B2: an unrefined revision refined while it waits, its slow files passing, stays silent", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
    landSlow(r, "pass");
    r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    const refined = setTimeout(() => r.store.meta.set(refinedMetaKey(r.worktreeId), "1"), 300);
    try {
      expect((await stopThenWait(harness, r, () => {})).waiting).toEqual({});
    } finally {
      clearTimeout(refined);
    }
  });
});
