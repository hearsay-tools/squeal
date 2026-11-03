import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  type PolicyFile,
  refinedMetaKey,
  type TestFileRef,
} from "../../src/core/types/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { FILE, type SquealRepo } from "./helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  landSlow,
  listenAsDaemon,
  repo,
  SLOW_FILE,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Spec 019 D4 for every group (row 019-14): Stop requires the checks of each
 * group it waits for (`stopRequires`: a group at `stop`, the default `slow`
 * group under `stop.requireSlowSuite`), asks the daemon to run the ones not
 * current, and its wait passes the old 600 s cap. Review 0.1.395 S1 (no
 * request while only the runner part is pending) and S2 (the request's
 * socket time stays inside the wait's bound), Claude Code and Codex alike.
 */

/** A configured group of the slow file, at `stop`, with no `slow` key marking it. */
const E2E: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };

/** `repo`'s fixture under `policy`: revision 1 with the slow file queued, the waiting entry known. */
async function withPolicy(
  harness: (typeof HARNESSES)[number],
  policy: PolicyFile,
): Promise<SquealRepo> {
  const r = await repo(harness, {});
  r.policy(policy);
  return r;
}

/** Counts the daemon's requests: `run-slow` lands the slow file as the slow tier would. */
async function countRequests(r: SquealRepo, land: "pass" | null = "pass") {
  const asked = { slow: 0 };
  await listenAsDaemon(r.store, r.worktreeId, {
    requestSlowSuite: async () => {
      asked.slow++;
      if (land !== null) setTimeout(() => landSlow(r, land), 100);
      return { revision: 1, queued: 1 };
    },
  });
  return asked;
}

describe.each(HARNESSES)("Stop for every group it waits for, $name (019 D4)", (harness) => {
  it("waits for a group at stop the slow keys never named, and ends silently once it passes", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 2_000 } });
    const timer = setTimeout(() => landSlow(r, "pass"), 300);
    onTestFinished(() => clearTimeout(timer));
    expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
    expect(turnOf(r)).toBe("idle");
  });

  it("blocks at the bound naming a group's file still not current, and asks no run-slow for it", async () => {
    const r = await withPolicy(harness, { checks: [E2E], stop: { slowWaitMs: 300 } });
    const asked = await countRequests(r, null);
    const out = await stopThenWait(harness, r);
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toContain("still not current at revision 1: test/e2e/slow.test.ts.");
    // Row 019-15 connects run-group at the marked line; the slow tier's request is not it.
    expect(asked.slow).toBe(0);
  });

  it("without the waiting entry known, the 2 s entry blocks at once on a group at stop", async () => {
    const r = await repo(harness, {}, false);
    r.policy({ checks: [E2E] });
    expect(decision(await harness.stop(r)).decision).toBe("block");
  });

  it("a group at edit or pause is not required: both entries end the turn at once", async () => {
    for (const at of ["edit", "pause"] as const) {
      const r = await withPolicy(harness, { checks: [{ ...E2E, at }] });
      const started = performance.now();
      expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
      expect(performance.now() - started).toBeLessThan(1_500);
      expect(turnOf(r)).toBe("idle");
    }
  });

  it("asks run-slow once for the default slow group beside a configured group at stop", async () => {
    const r = await withPolicy(harness, {
      // FILE, passing at revision 1, is the configured group's; the slow file is the default group's.
      checks: [{ name: "unit", runner: "vitest", tests: [FILE.path], at: "stop" }],
      slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE.path] },
      stop: { requireSlowSuite: true, slowWaitMs: 5_000 },
    });
    const asked = await countRequests(r);
    expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
    expect(asked.slow).toBe(1);
  });

  it("passes 600 s on a fast clock, and ends silently when the file lands after it", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 1_800_000 });
    let fake = 0;
    let landedAt: number | null = null;
    const fast: HookDeps = {
      ...deps,
      // 100 s per read of the wait's clock; the file lands once 700 s have passed.
      monotonicNow: () => {
        fake += 100_000;
        if (fake >= 700_000 && landedAt === null) {
          landedAt = fake;
          landSlow(r, "pass");
        }
        return fake;
      },
    };
    const out = await stopThenWait(harness, r, () => {}, fast);
    expect(out).toEqual({ quick: {}, waiting: {} });
    expect(landedAt).toBeGreaterThan(600_000);
    expect(turnOf(r)).toBe("idle");
  });

  it("on a fast clock, blocks only at its own bound past 600 s, naming the time waited", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 1_800_000 });
    let fake = 0;
    const fast: HookDeps = { ...deps, monotonicNow: () => (fake += 100_000) };
    const out = await stopThenWait(harness, r, () => {}, fast);
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /^Squeal policy stop.requireSlowSuite is on and after 1800 s /,
    );
    expect(fake).toBeGreaterThanOrEqual(1_800_000);
  });

  it("S1: asks nothing while only the runner part is pending, then once for a file it lists", {
    timeout: 15_000,
  }, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 1_500 });
    r.policy({
      slow: { ...DEFAULT_POLICY.slow, include: ["test/e2e/**", FILE.path] },
      stop: { requireSlowSuite: true, slowWaitMs: 1_500 },
    });
    landSlow(r, "pass");
    r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
    const LATE: TestFileRef = { project: "", path: "test/e2e/late.test.ts" };
    const asked = await countRequests(r, null);
    let beforeListing: number | null = null;
    const list = () => {
      beforeListing = asked.slow;
      // The runner part lists a slow file not run and not queued (a lookup-only miss).
      r.store.testFileKeys.upsertMany([
        { worktreeId: r.worktreeId, testFile: LATE, key: "late1", revision: 1, pending: null },
      ]);
      r.store.meta.set(refinedMetaKey(r.worktreeId), "1");
    };
    const timer = setTimeout(list, 400);
    onTestFinished(() => clearTimeout(timer));
    const out = await stopThenWait(harness, r, () => {}, { ...deps, pollIntervalMs: 50 });
    expect(beforeListing).toBe(0);
    expect(asked.slow).toBe(1);
    expect(out.waiting.reason).toContain("still not current at revision 1: test/e2e/late.test.ts.");
  });

  it("S2: a daemon that takes the request and never answers costs at most the wait's bound", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 200 });
    const requests = await silentDaemon(r);
    expect(decision(await harness.stop(r))).toEqual({});
    const started = performance.now();
    const waiting = decision(await harness.stopSlow(r));
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(requests()).toBe(1);
    expect(waiting.reason).toMatch(/still not current at revision 1: test\/e2e\/slow.test.ts\./);
  });

  it("S2: with no wait at all it sends nothing and blocks at once", async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 0 });
    const requests = await silentDaemon(r);
    expect(decision(await harness.stop(r))).toEqual({});
    const started = performance.now();
    const waiting = decision(await harness.stopSlow(r));
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(requests()).toBe(0);
    expect(waiting.reason).toMatch(/^Squeal policy stop.requireSlowSuite is on and after 0 s /);
  });
});

/**
 * Review 0.1.395 S2: a socket that accepts a request and never answers, as
 * the worktree's daemon; counts the `run-slow` requests it received.
 */
async function silentDaemon(r: SquealRepo): Promise<() => number> {
  const record = r.store.worktrees.get(r.worktreeId)?.daemon;
  if (record === undefined || record === null) throw new Error("no daemon record");
  const dir = mkdtempSync(join(tmpdir(), "squeal-019-14-"));
  const socketPath = join(dir, "d.sock");
  let runSlow = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => {
      if (String(chunk).includes('"run-slow"')) runSlow++;
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  r.store.worktrees.setDaemon(r.worktreeId, { ...record, socketPath });
  return () => runSlow;
}
