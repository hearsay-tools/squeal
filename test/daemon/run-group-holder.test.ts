import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { type DeskEvents, type FrontDesk, prepareFrontDesk } from "../../src/core/daemon/desk.js";
import {
  groupRequests,
  type Held,
  type HeldBy,
  keyingStep,
  MainSteps,
  requestGroup,
} from "../../src/core/daemon/run-group.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import type {
  AbsolutePath,
  DaemonResponse,
  RevisionNumber,
  Scheduler,
} from "../../src/core/types/index.js";

/*
 * Row 011-302 (gh-154): until the scheduler took a `run-group` request, each
 * answer says what holds it: the main thread that has not read it, the
 * daemon's startup, or the scheduler lock's holder, with the main thread's
 * step beside. The main thread tells the socket only while a request waits.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const QUEUED = { revision: 3 as RevisionNumber, queued: 2 };

/** A scheduler of the real lock whose `requestGroup` takes it, as `TierScheduler`'s does. */
function lockedScheduler(watch = true) {
  const lock = new Mutex();
  const scheduler = {
    requestGroup: (group: string) => lock.run(() => QUEUED, `taking a squeal run ${group} request`),
    ...(watch
      ? { watchLock: (listener: Parameters<Mutex["watch"]>[0]) => lock.watch(listener) }
      : {}),
  } as unknown as Scheduler;
  /** Holds the lock as `operation` until the returned function is called. */
  const hold = (operation: string) => {
    let release = () => {};
    void lock.run(() => new Promise<void>((resolve) => (release = resolve)), operation);
    return () => release();
  };
  return { lock, scheduler, hold };
}

const turnOver = async (lock: Mutex) => {
  for (let i = 0; i < 5; i++) await lock.run(() => {}, `task ${i}`);
};

describe("groupRequests: what holds a pending request (row 011-302)", () => {
  it("names the unread request, then startup, the lock's holder or nothing, and none once taken", async () => {
    let now = 10_000;
    let held: Held = () => {};
    let take: (requested: typeof QUEUED) => void = () => {};
    let step: { operation: string; since: number } | null = null;
    const groups = groupRequests(
      (_group, tell) => {
        held = tell;
        return new Promise((resolve) => (take = resolve));
      },
      8,
      () => step,
      () => now,
    );
    const { requestId } = groups.start("lint");
    const holder = () => groups.status(requestId)?.holder;
    now = 31_000;
    expect(holder()).toEqual({ kind: "unanswered", heldMs: 21_000, step: null });
    held({ kind: "startup", since: 1_000 });
    expect(holder()).toEqual({ kind: "startup", heldMs: 30_000, step: null });
    step = { operation: "keying lint checks", since: 25_000 };
    held({ kind: "scheduler", operation: "applying revision 412", since: 7_000 });
    expect(holder()).toEqual({
      kind: "scheduler",
      operation: "applying revision 412",
      heldMs: 24_000,
      step: { operation: "keying lint checks", heldMs: 6_000 },
    });
    step = null;
    held(null);
    expect(holder()).toEqual({ kind: "unknown", step: null });
    take(QUEUED);
    await new Promise((resolve) => setImmediate(resolve));
    expect(groups.status(requestId)).toMatchObject({ requested: QUEUED, holder: null });
  });

  it("keeps the oldest step that still runs", () => {
    const steps = new MainSteps();
    expect(steps.current()).toBeNull();
    steps.set(keyingStep("eslint"), 5);
    steps.set(keyingStep("oxlint"), 3);
    expect(steps.current()).toEqual({ operation: "keying oxlint lint checks", since: 3 });
    steps.set(keyingStep("oxlint"), null);
    expect(steps.current()).toEqual({ operation: "keying lint checks", since: 5 });
    steps.set("keying lint checks", null);
    expect(steps.current()).toBeNull();
  });
});

describe("requestGroup watches the lock only while its request waits (row 011-302)", () => {
  it("tells the holder it waits behind, and nothing before the request or once taken", async () => {
    const { lock, scheduler, hold } = lockedScheduler();
    const heard: HeldBy[] = [];
    const held: Held = (holder) => heard.push(holder);
    await turnOver(lock);
    expect(heard).toEqual([]);
    const release = hold("applying revision 412");
    await new Promise((resolve) => setImmediate(resolve));
    const request = requestGroup(scheduler, "lint", held);
    expect(heard).toEqual([
      { kind: "scheduler", operation: "applying revision 412", since: expect.any(Number) },
    ]);
    release();
    expect(await request).toEqual(QUEUED);
    // Between holders the lock is free; its own task is the last holder the request hears.
    expect(heard.map((h) => h?.kind === "scheduler" && h.operation)).toEqual([
      "applying revision 412",
      false,
      "taking a squeal run lint request",
      false,
    ]);
    const told = heard.length;
    await turnOver(lock);
    expect(heard).toHaveLength(told);
  });

  it("says nothing holds it with a scheduler that cannot watch its lock", async () => {
    const { scheduler } = lockedScheduler(false);
    const heard: HeldBy[] = [];
    expect(await requestGroup(scheduler, "lint", (holder) => heard.push(holder))).toEqual(QUEUED);
    expect(heard).toEqual([null]);
  });
});

describe("what holds a request, through the front desk (row 011-302)", () => {
  const worker = {
    script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
    execArgv: [
      "--disable-warning=ExperimentalWarning",
      "--import",
      fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
    ],
  };

  async function open(
    inWorker: boolean,
    requestGroup: NonNullable<DeskEvents["requestGroup"]>,
  ): Promise<{ socketPath: AbsolutePath; desk: FrontDesk }> {
    const dir = mkdtempSync("/tmp/sq-holder-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const desk = await prepareFrontDesk(inWorker ? worker : null).open(
      {
        socketPath,
        worktreeId: "0123456789abcdef" as never,
        root: "/",
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
        token: "t",
      },
      {
        onActivity: () => {},
        requestFullSuite: () => new Promise(() => {}),
        requestSlowSuite: () => new Promise(() => {}),
        requestGroup,
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    return { socketPath, desk };
  }

  /** The request's answer once `ready` holds for it, polled every 10 ms for at most 2 s. */
  async function answerOnce(
    socketPath: AbsolutePath,
    requestId: string,
    ready: (answer: DaemonResponse) => boolean,
  ): Promise<DaemonResponse> {
    for (let started = Date.now(); ; ) {
      const answer = await requestDaemon(
        socketPath,
        { type: "run-group-status", requestId },
        2_000,
      );
      if (ready(answer) || Date.now() - started > 2_000) return answer;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const idOf = (answer: DaemonResponse): string => {
    if (!answer.ok || answer.type !== "run-group") throw new Error(JSON.stringify(answer));
    return answer.requestId;
  };
  const holderOf = (answer: DaemonResponse) =>
    answer.ok && answer.type === "run-group" ? answer.holder : undefined;

  for (const inWorker of [false, true]) {
    const where = inWorker ? "in its worker thread" : "on the main thread";

    it(`names the lock's holder and the main thread's step ${where}`, async () => {
      const { scheduler, hold } = lockedScheduler();
      const release = hold("applying revision 412");
      const { socketPath, desk } = await open(inWorker, (group, held) =>
        requestGroup(scheduler, group, held),
      );
      desk.step("keying lint checks", true);
      const id = idOf(await requestDaemon(socketPath, { type: "run-group", group: "lint" }, 2_000));
      const pending = await answerOnce(
        socketPath,
        id,
        (a) => holderOf(a)?.kind === "scheduler" && holderOf(a)?.step !== null,
      );
      expect(holderOf(pending)).toEqual({
        kind: "scheduler",
        operation: "applying revision 412",
        heldMs: expect.any(Number),
        step: { operation: "keying lint checks", heldMs: expect.any(Number) },
      });
      release();
      const taken = await answerOnce(socketPath, id, (a) => holderOf(a) === null);
      expect(taken).toMatchObject({ requested: QUEUED, holder: null });
    });
  }

  it("names a request the main thread has not read, from the worker", async () => {
    const { socketPath } = await open(true, () => new Promise(() => {}));
    const id = idOf(await requestDaemon(socketPath, { type: "run-group", group: "lint" }, 2_000));
    const answer = await requestDaemon(
      socketPath,
      { type: "run-group-status", requestId: id },
      2_000,
    );
    expect(holderOf(answer)).toEqual({
      kind: "unanswered",
      heldMs: expect.any(Number),
      step: null,
    });
  });

  it("posts no run-group-held message while no request waits", async () => {
    const posted = vi.spyOn(Worker.prototype, "postMessage");
    const heldPosts = () =>
      posted.mock.calls.filter(
        ([message]) => (message as { type: string }).type === "run-group-held",
      ).length;
    const { lock, scheduler, hold } = lockedScheduler();
    const { socketPath } = await open(true, (group, held) => requestGroup(scheduler, group, held));
    await turnOver(lock);
    expect(heldPosts()).toBe(0);
    const release = hold("applying revision 412");
    const id = idOf(await requestDaemon(socketPath, { type: "run-group", group: "lint" }, 2_000));
    await answerOnce(socketPath, id, (a) => holderOf(a)?.kind === "scheduler");
    expect(heldPosts()).toBeGreaterThan(0);
    release();
    await answerOnce(socketPath, id, (a) => holderOf(a) === null);
    const told = heldPosts();
    await turnOver(lock);
    expect(heldPosts()).toBe(told);
  });
});
