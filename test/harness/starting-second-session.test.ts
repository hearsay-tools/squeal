import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAEMON_START_SLOW_MS } from "../../src/core/presence/heartbeat.js";
import { startMarkFor } from "../../src/core/presence/marks.js";
import { utcTimeText } from "../../src/core/text.js";
import { holdStart, newWorktree, T } from "./starting-fixture.js";

/*
 * Row 005-108, review 0.1.547 B1: a session that registers while one daemon start is current
 * reads that start's mark, one time in its registration and in any later message, and a start
 * already past `DAEMON_START_SLOW_MS` is told slow once per session, in its registration. Before
 * the repair a second session at +90 s was told "starting since" its own time (09:01:30), then
 * its boundary at +101 s told the slow start again with the mark's time (09:00:00).
 */

const OTHER = "0f3c2a51-7d1e-4b8a-9c55-2e6f1d0b4a77";
const MARK = utcTimeText(T);
const SLOW = `A daemon has been starting since ${MARK}`;
const BOUND = DAEMON_START_SLOW_MS + 1_000;

describe("a second session during one slow daemon start (review 0.1.547 B1)", () => {
  it("registered past the bound, is told the mark's time once, in its registration", async () => {
    const { batch, sessionStart, spawns, lockFile } = await newWorktree();
    holdStart(lockFile);
    expect(await batch(85_000)).toContain(SLOW);

    const registration = await sessionStart(90_000, { session_id: OTHER });
    const next = await batch(101_000, OTHER);

    // Before the repair: "since 2026-11-18T09:01:30.000Z", then the notice again at +101 s.
    expect(registration).toContain(SLOW);
    expect(registration).not.toContain(new Date(T + 90_000).toISOString());
    expect(next).toBe("");
    // The marked start is current: neither session's hooks spawn a second daemon.
    expect(spawns).toEqual([0]);
  });

  it("registered before the bound, is told the start once at the bound, with the mark's time", async () => {
    const { batch, sessionStart, lockFile } = await newWorktree();
    holdStart(lockFile);

    const registration = await sessionStart(30_000, { session_id: OTHER });
    const said = [
      await batch(45_000, OTHER),
      await batch(BOUND, OTHER),
      await batch(BOUND + 10_000, OTHER),
    ];

    expect(registration).toContain("Squeal is still starting in this worktree");
    expect(registration).not.toContain("has been starting");
    expect(said[0]).toBe("");
    expect(said[1]).toContain(SLOW);
    expect(said[2]).toBe("");
  });

  it("leaves the first session as it was: one notice at the bound, with the mark's time", async () => {
    const { batch, sessionStart, lockFile } = await newWorktree();
    holdStart(lockFile);

    await sessionStart(90_000, { session_id: OTHER });
    const said = [await batch(BOUND), await batch(BOUND + 40_000)];

    expect(said[0]).toContain(SLOW);
    expect(said[1]).toBe("");
  });

  it("a resumed session past the bound is told the mark's time in its registration, not again after", async () => {
    const { batch, sessionStart, lockFile } = await newWorktree();
    holdStart(lockFile);
    expect(await batch(BOUND)).toContain(SLOW);

    const registration = await sessionStart(BOUND + 9_000, { source: "resume" });
    const next = await batch(BOUND + 20_000);

    expect(registration).toContain(SLOW);
    expect(next).toBe("");
  });
});

describe("after a told slow start, the next change is still news (review 0.1.547 B1)", () => {
  it("a start that dies is told as no daemon running", async () => {
    const { batch, sessionStart, lockFile } = await newWorktree();
    const lock = holdStart(lockFile);
    expect(await sessionStart(90_000, { session_id: OTHER })).toContain(SLOW);

    // The start fails: its lock and mark go, as `openDaemon`'s release does.
    lock.release();
    const next = await batch(101_000, OTHER);

    expect(next).toContain("no daemon is running");
  });

  it("a start that registers is told as validating", async () => {
    const { r, batch, sessionStart, lockFile } = await newWorktree();
    holdStart(lockFile);
    expect(await sessionStart(90_000, { session_id: OTHER })).toContain(SLOW);

    // The daemon registers: its row and record with a fresh heartbeat; its start mark goes.
    r.store.worktrees.upsert({
      id: r.worktreeId,
      root: r.root,
      commonDir: r.repo.commonDir,
      isMain: true,
      registeredAt: T + 99_000,
      daemon: {
        socketPath: `/tmp/squeal-test-${r.worktreeId}.sock`,
        startedAt: T,
        heartbeatAt: T + 100_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });
    rmSync(startMarkFor(lockFile), { force: true });
    const next = await batch(101_000, OTHER);

    expect(next).toContain("a daemon is validating again");
  });
});
