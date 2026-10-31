import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { retryCommand } from "../../src/cli/retry.js";
import { createPermitPool } from "../../src/core/capacity/index.js";
import { readRetries } from "../../src/core/retry/index.js";
import { acquireSlowSlot } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import type { AbsolutePath, StatusSnapshot } from "../../src/core/types/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import { claimRepo, fileName, side } from "../scheduler/claims-fixture.js";

/*
 * Row 011-272 (gh-114, `research/issue-114.md`): an environment retry of a
 * slow file, through the real CLI, scheduler, store and slow slot, says it
 * is queued and what holds it, in its receipt and in status: fast work, then
 * the slot another daemon holds, then its run, then nothing once it passed.
 * Its FAIL stays counted until then. The runner and the daemon's socket are
 * stand-ins; the slot is a private directory. Review 0.1.382 B1: the slow
 * tier publishes the same wait for a full worker pool, so the words name
 * capacity and not which of the two holds it.
 */

const SLOW = fileName(0);
/** Each step's bound: the scheduler's starts and the runner's stand-in run under the host's load. */
const POLL = { timeout: 10_000 };
const FAST = fileName(1);
/** The slow tier's `waiting: slot`, for the slow slot and the shared worker pool alike (review 0.1.382 B1). */
const CAPACITY =
  "the slow tier waits for capacity; whether the slow slot or the shared worker pool holds it is not known";

it("a slow retry is queued behind fast work, then the slot, then runs, and says so each time", {
  timeout: 60_000,
}, async () => {
  const runtime = mkdtempSync(join(tmpdir(), "sq-272-"));
  const saved = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = runtime;
  onTestFinished(() => {
    closeFakeDaemons();
    process.env.XDG_RUNTIME_DIR = saved;
    rmSync(runtime, { recursive: true, force: true });
  });
  // Status reads the slot's holders where the daemon takes it; the slot makes it private (0700).
  const slotDir = join(runtime, "squeal") as AbsolutePath;
  const config = JSON.stringify({ slow: { include: [SLOW] } });
  const { main } = claimRepo(2, { "squeal.config.json": config }, 0);
  const h = side(main, {
    count: 2,
    rerunCap: 0,
    policy: {
      baseline: { onStart: "lookup-then-run-missing" },
      slow: { ...DEFAULT_POLICY.slow, include: [SLOW], quietMs: 0, maxParallel: 1 },
    },
    slow: { slotDir, recheckMs: 25, load: () => [0.5], cpus: () => 1 },
  });
  h.runner.failing.add(SLOW);
  await h.scheduler.start();
  await expect.poll(() => h.runner.ran(SLOW), POLL).toBe(1);
  await h.scheduler.idle();

  // Another daemon's permit holds the slot; an edit's fast run is held open.
  const slot = acquireSlowSlot({
    dir: slotDir,
    owner: { pid: process.pid, worktreeId: "other-daemon" },
    permits: 1,
  });
  expect(slot).not.toBeNull();
  onTestFinished(() => slot?.release());
  const fastRun = held();
  const slowRun = held();
  onTestFinished(() => {
    fastRun.open();
    slowRun.open();
  });
  h.runner.during = (files) =>
    files.some((f) => f.path === FAST)
      ? fastRun.shut
      : files.some((f) => f.path === SLOW)
        ? slowRun.shut
        : undefined;
  writeFileSync(join(main, FAST), "// changed fast input\n");
  await h.batch(FAST);
  await expect.poll(() => h.runner.active, POLL).toBe(1);
  h.runner.failing.delete(SLOW);
  const daemon = h.store.worktrees.get(h.worktreeId)?.daemon;
  await fakeDaemon(daemon?.socketPath as string, { ping: [ping(h.worktreeId, main)] });
  const fastSince = timeText(openRun(h.store, h.worktreeId, FAST));

  const asked = await retry(main, "s1");
  expect(asked).toEqual({
    code: 0,
    stdout: `Retry queued (reason: environment): ${SLOW} runs once more in its turn at its normal priority; it has not started: fast work goes first (a run open since ${fastSince}). ${TAIL}\n`,
  });
  // The daemon's answer to the socket's notice: it claims and queues the retry.
  await h.scheduler.requestRetries();
  await expect.poll(() => h.phase(SLOW), POLL).toBe("queued");
  expect(retryLine(main)).toEqual({
    text: `  1 test file with a pending retry (environment): ${SLOW}; queued and not started: fast work goes first (a run open since ${fastSince})`,
    waits: { kind: "fast", since: expect.any(Number) },
    failing: true,
  });

  fastRun.open();
  await expect
    .poll(() => readSlowActivity(h.store, h.worktreeId), POLL)
    .toEqual({ kind: "waiting", for: "slot" });
  const slotWait = `it has not started: ${CAPACITY}.`;
  expect((await retry(main, "s2")).stdout).toBe(
    `Retry queued (reason: environment): ${SLOW} runs once more in its turn at its normal priority; ${slotWait} It joins a retry another session asked for. ${TAIL}\n`,
  );
  expect(retryLine(main)).toEqual({
    text: `  1 test file with a pending retry (environment): ${SLOW}; queued and not started: ${CAPACITY}`,
    waits: { kind: "slot" },
    failing: true,
  });
  expect(h.runner.ran(SLOW)).toBe(1);

  slot?.release();
  await expect.poll(() => h.phase(SLOW), POLL).toBe("running");
  const since = timeText(openRun(h.store, h.worktreeId, SLOW));
  expect((await retry(main, "s3")).stdout).toContain(
    `${SLOW} runs once more in its turn at its normal priority; a run of it at these inputs is running since ${since}.`,
  );
  expect(retryLine(main)).toEqual({
    text: `  1 test file with a pending retry (environment): ${SLOW}; running since ${since}`,
    failing: true,
  });

  slowRun.open();
  await expect
    .poll(() => readRetries(h.store).every((r) => r.end?.outcome === "passed"), POLL)
    .toBe(true);
  expect(retryLine(main)).toEqual({ failing: false });
  expect(await retry(main, "s1")).toEqual({
    code: 1,
    stdout: `Not retried: ${SLOW} has no known failure in this worktree.\n`,
  });
  expect(h.runner.ran(SLOW)).toBe(2);
});

it("a slow retry the full worker pool holds, beside a free slow slot, does not name the slow slot", {
  timeout: 60_000,
}, async () => {
  const runtime = mkdtempSync(join(tmpdir(), "sq-272-pool-"));
  const saved = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = runtime;
  onTestFinished(() => {
    closeFakeDaemons();
    process.env.XDG_RUNTIME_DIR = saved;
    rmSync(runtime, { recursive: true, force: true });
  });
  const slotDir = join(runtime, "squeal") as AbsolutePath;
  const poolDir = join(runtime, "pool") as AbsolutePath;
  const config = JSON.stringify({ slow: { include: [SLOW] } });
  const { main } = claimRepo(1, { "squeal.config.json": config }, 0);
  const h = side(main, {
    count: 1,
    rerunCap: 0,
    policy: {
      baseline: { onStart: "lookup-then-run-missing" },
      slow: { ...DEFAULT_POLICY.slow, include: [SLOW], quietMs: 0, maxParallel: 1 },
    },
    slow: { slotDir, recheckMs: 25, load: () => [0.5], cpus: () => 1 },
    capacity: { dir: poolDir, hostSlots: 1, host: null },
  });
  h.runner.failing.add(SLOW);
  await h.scheduler.start();
  await expect.poll(() => h.runner.ran(SLOW), POLL).toBe(1);
  await h.scheduler.idle();

  // Another daemon takes the pool's one permit; nobody holds the slow slot.
  const other = createPermitPool({
    dir: poolDir,
    owner: { pid: process.pid, worktreeId: "other-daemon" },
    hostSlots: 1,
    cores: null,
  });
  onTestFinished(() => other.close());
  expect(other.acquire(1)?.permits).toBe(1);
  h.runner.failing.delete(SLOW);
  const daemon = h.store.worktrees.get(h.worktreeId)?.daemon;
  await fakeDaemon(daemon?.socketPath as string, { ping: [ping(h.worktreeId, main)] });

  expect((await retry(main, "s1")).code).toBe(0);
  await h.scheduler.requestRetries();
  await expect.poll(() => h.phase(SLOW), POLL).toBe("queued");
  await expect
    .poll(() => readSlowActivity(h.store, h.worktreeId), POLL)
    .toEqual({ kind: "waiting", for: "slot" });
  // The slot is free: a third owner takes it between the scheduler's looks.
  await expect.poll(() => slotFree(slotDir), POLL).toBe(true);

  expect((await retry(main, "s2")).stdout).toBe(
    `Retry queued (reason: environment): ${SLOW} runs once more in its turn at its normal priority; it has not started: ${CAPACITY}. It joins a retry another session asked for. ${TAIL}\n`,
  );
  expect(retryLine(main)).toEqual({
    text: `  1 test file with a pending retry (environment): ${SLOW}; queued and not started: ${CAPACITY}`,
    waits: { kind: "slot" },
    failing: true,
  });
  expect(h.runner.ran(SLOW)).toBe(1);

  // The pool held it: once its permit is free, the retry runs and passes.
  other.close();
  await expect
    .poll(() => readRetries(h.store).every((r) => r.end?.outcome === "passed"), POLL)
    .toBe(true);
  expect(retryLine(main)).toEqual({ failing: false });
  expect(h.runner.ran(SLOW)).toBe(2);
});

/** Whether another owner can take the slow slot now; it gives it back at once. */
function slotFree(dir: AbsolutePath): boolean {
  const slot = acquireSlowSlot({
    dir,
    owner: { pid: process.pid, worktreeId: "third" },
    permits: 1,
  });
  slot?.release();
  return slot !== null;
}

function ping(worktreeId: string, root: string) {
  return {
    ok: true,
    type: "ping",
    pid: process.pid,
    worktreeId,
    root,
    squealVersion: "0.0.0-test",
    phase: "ready",
    startedAt: Date.now(),
  };
}

const TAIL =
  "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.";

function held(): { shut: Promise<void>; open: () => void } {
  let open = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { shut, open };
}

/** `path`'s open run's start in the store. */
function openRun(store: ReturnType<typeof side>["store"], worktreeId: string, path: string) {
  const run = store.runs
    .inFlight(worktreeId, 0)
    .find((r) => r.testFiles.some((f) => f.path === path));
  expect(run).toBeDefined();
  return run?.startedAt ?? 0;
}

async function retry(root: string, session: string) {
  let stdout = "";
  const code = await retryCommand([SLOW, "--reason", "environment"], {
    cwd: root,
    env: { CLAUDE_CODE_SESSION_ID: session },
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stdout += text;
    },
  });
  return { code, stdout };
}

/**
 * Status's retry line, its group's `waits` in the JSON payload, and whether
 * the slow file's FAIL is among the known failures.
 */
function retryLine(root: string) {
  const status = readStatus(root as AbsolutePath) as StatusSnapshot;
  const json = JSON.parse(JSON.stringify(status)) as StatusSnapshot;
  const group = json.outstanding?.find((g) => g.standing.kind === "retry");
  const text = formatStatus(status, Date.now())
    .split("\n")
    .find((l) => l.includes("pending retry"));
  const failing = status.knownFailures.some(
    (f) => f.check.kind !== "setup" && f.check.testPath === SLOW,
  );
  if (group === undefined || text === undefined) return { failing };
  const waits = group.standing.kind === "retry" ? group.standing.waits : undefined;
  return { text, ...(waits === undefined ? {} : { waits }), failing };
}
