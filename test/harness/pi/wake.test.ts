import { setTimeout as sleep } from "node:timers/promises";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiContext } from "../../../src/harness/pi/api.js";
import { squealExtension, WAIT_BOUND_MS, WAKE_REARMS } from "../../../src/harness/pi/extension.js";
import { IDLE_WAIT_MS } from "../../../src/harness/pi/run.js";
import { type FakeWorker, type FakeWorkerOptions, fakeWorker } from "./fake-worker.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Spec 009 D5: `agent_settled` arms the idle wake in `tui` and `rpc` only;
 * its news starts a run as a follow-up; a prompt, a run's start and
 * `session_shutdown` cancel it, and a cancelled or empty wait says nothing.
 * Row 011-433: a wait that ends empty before its bound, not cancelled, is
 * armed again, a bounded number of times.
 */

const SESSION = "019a0000-0000-7000-8000-000000000005";
const WAKE = "SQUEAL · revision 4: PASS -> FAIL";

async function settled(mode: PiContext["mode"], options: FakeWorkerOptions = {}, rearmDelayMs = 0) {
  const worker = fakeWorker({ ...options, answers: { start: null, ...options.answers } });
  const pi = stubPi();
  const ctx = piContext(SESSION, "/repo", mode);
  squealExtension(worker.start, rearmDelayMs)(pi.api);
  await pi.start("startup", ctx);
  await pi.fire("agent_settled", {}, ctx);
  return { pi, worker, ctx };
}

afterEach(() => {
  vi.useRealTimers();
});

// Counts its sleeps, not the clock: one test fakes `performance`.
async function until(done: () => boolean, ms = 2_000): Promise<void> {
  for (let slept = 0; !done() && slept < ms; slept += 10) await sleep(10);
}

describe("the idle wake", () => {
  it.each(["tui", "rpc"] as const)(
    "in %s, wakes the agent with the wait's news as a follow-up that starts a run",
    async (mode) => {
      const { pi, worker } = await settled(mode, { answers: { wait: WAKE } });
      await until(() => pi.sent.length > 0);
      expect(pi.sent).toEqual([
        {
          message: { customType: "squeal", content: WAKE, display: true },
          options: { triggerTurn: true, deliverAs: "followUp" },
        },
      ]);
      expect(worker.seen.map((request) => request.kind)).toEqual(["start", "endTurn", "wait"]);
      expect(worker.seen.at(-1)).toEqual({ kind: "wait", sessionId: SESSION, cwd: "/repo" });
    },
  );

  it.each(["print", "json"] as const)("under %s, arms nothing", async (mode) => {
    const { pi, worker } = await settled(mode, { answers: { wait: WAKE } });
    await sleep(100);
    expect(worker.count("endTurn")).toBe(1);
    expect(worker.count("wait")).toBe(0);
    expect(pi.sent).toEqual([]);
  });

  it("is silent when every wait ends without news, armed again a bounded number of times", async () => {
    const { pi, worker } = await settled("rpc", { answers: { wait: null } });
    await until(() => worker.count("wait") === 1 + WAKE_REARMS);
    await sleep(50);
    expect(worker.count("wait")).toBe(1 + WAKE_REARMS);
    expect(pi.sent).toEqual([]);
  });

  it("delivers the news of a re-arm after a first wait that ended empty", {
    timeout: 15_000,
  }, async () => {
    // The first wait ends `null` as a dead worker's or an unopened store's does.
    const { pi, worker } = await settled("rpc", { sequences: { wait: [null, WAKE] } });
    await until(() => pi.sent.length === 1, 10_000);
    expect(pi.sent.map((sent) => sent.message.content)).toEqual([WAKE]);
    expect(worker.count("wait")).toBe(2);
    expect(worker.cancelled).toEqual([]);
  });

  /** Settles in `rpc` on `fakes`, one per worker the host starts; `workers` are the started ones. */
  async function onWorkers(...fakes: FakeWorker[]) {
    const workers: Worker[] = [];
    const pi = stubPi();
    const ctx = piContext(SESSION, "/repo", "rpc");
    const start = () => {
      const worker = (fakes[workers.length] ?? fakes.at(-1))?.start() as Worker;
      workers.push(worker);
      return worker;
    };
    squealExtension(start, 0)(pi.api);
    await pi.start("startup", ctx);
    await pi.fire("agent_settled", {}, ctx);
    return { pi, workers };
  }

  it("is armed again on a new worker when the waiting worker dies, and delivers its news", {
    timeout: 15_000,
  }, async () => {
    const dying = fakeWorker({ answers: { start: null }, stall: ["wait"] });
    const next = fakeWorker({ answers: { wait: WAKE } });
    const { pi, workers } = await onWorkers(dying, next);
    await until(() => dying.count("wait") === 1);
    await workers[0]?.terminate();
    await until(() => pi.sent.length === 1, 10_000);
    expect(pi.sent.map((sent) => sent.message.content)).toEqual([WAKE]);
    expect(next.count("wait")).toBe(1);
  });

  it("is not armed again when the empty wait lasted the worker's bound: that is expiry", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const dying = fakeWorker({ answers: { start: null }, stall: ["wait"] });
    const next = fakeWorker({ answers: { wait: WAKE } });
    const { pi, workers } = await onWorkers(dying, next);
    await until(() => dying.count("wait") === 1);
    vi.advanceTimersByTime(WAIT_BOUND_MS);
    await workers[0]?.terminate();
    await sleep(200);
    expect(workers).toHaveLength(1);
    expect(next.count("wait")).toBe(0);
    expect(pi.sent).toEqual([]);
  });

  it("keeps the worker's own bound", () => {
    expect(WAIT_BOUND_MS).toBe(IDLE_WAIT_MS);
  });

  it.each([
    ["input", { text: "next", source: "rpc" }],
    ["before_agent_start", { prompt: "next", systemPromptOptions: { sections: {} } }],
  ] as const)("is cancelled by %s, and says nothing", async (type, event) => {
    const { pi, worker, ctx } = await settled("rpc", { stall: ["wait"] });
    await until(() => worker.count("wait") === 1);
    await pi.fire(type, event, ctx);
    await until(() => worker.cancelled.length === 1);
    expect(worker.cancelled).toHaveLength(1);
    await sleep(50);
    expect(worker.count("wait")).toBe(1);
    expect(pi.sent).toEqual([]);
  });

  it.each([
    ["input", { text: "next", source: "rpc" }],
    ["none", {}],
  ] as const)("in the pause before a re-arm, is cancelled by %s", async (type, event) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { pi, worker, ctx } = await settled("rpc", { sequences: { wait: [null] } }, 60_000);
    await until(() => worker.count("wait") === 1);
    // The empty answer reached the extension once the start of its pause is pending.
    await until(() => vi.getTimerCount() === 1);
    if (type === "input") await pi.fire(type, event, ctx);
    vi.advanceTimersByTime(60_000);
    await sleep(100);
    expect(worker.count("wait")).toBe(type === "input" ? 1 : 2);
  });

  it("is cancelled by session_shutdown, before the session unregisters", async () => {
    const { pi, worker, ctx } = await settled("tui", { stall: ["wait"] });
    await until(() => worker.count("wait") === 1);
    await pi.shutdown("quit", ctx);
    expect(worker.cancelled).toHaveLength(1);
    expect(worker.seen.at(-1)?.kind).toBe("shutdown");
    await pi.fire("agent_settled", {}, ctx);
    await sleep(50);
    expect(worker.count("wait")).toBe(1);
    expect(pi.sent).toEqual([]);
  });

  it("arms again at the next settle, one wait at a time", async () => {
    // The second wait ends empty; its re-arm waits past the test.
    const { pi, worker, ctx } = await settled("rpc", { sequences: { wait: [WAKE] } }, 60_000);
    await until(() => pi.sent.length === 1);
    await pi.fire("before_agent_start", { systemPromptOptions: { sections: {} } }, ctx);
    await pi.fire("agent_settled", {}, ctx);
    await until(() => worker.count("wait") === 2);
    expect(worker.count("wait")).toBe(2);
    expect(worker.cancelled).toEqual([]);
    expect(pi.sent).toHaveLength(1);
  });

  it("arms nothing on a stale context", async () => {
    const worker = fakeWorker({ answers: { start: null, wait: WAKE } });
    const pi = stubPi();
    squealExtension(worker.start)(pi.api);
    await pi.start("startup", piContext(SESSION, "/repo", "rpc"));
    const stale = {
      get mode(): never {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
      cwd: "/repo",
      sessionManager: { getSessionId: () => SESSION },
    } as unknown as PiContext;
    await expect(pi.fire("agent_settled", {}, stale)).resolves.toBeUndefined();
    await sleep(100);
    expect(worker.count("wait")).toBe(0);
  });
});
