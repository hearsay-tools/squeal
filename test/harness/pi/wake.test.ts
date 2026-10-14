import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { PiContext } from "../../../src/harness/pi/api.js";
import { squealExtension } from "../../../src/harness/pi/extension.js";
import { type FakeWorkerOptions, fakeWorker } from "./fake-worker.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Spec 009 D5: `agent_settled` arms the idle wake in `tui` and `rpc` only;
 * its news starts a run as a follow-up; a prompt, a run's start and
 * `session_shutdown` cancel it, and a cancelled or empty wait says nothing.
 */

const SESSION = "019a0000-0000-7000-8000-000000000005";
const WAKE = "SQUEAL · revision 4: PASS -> FAIL";

async function settled(mode: PiContext["mode"], options: FakeWorkerOptions = {}) {
  const worker = fakeWorker({ ...options, answers: { start: null, ...options.answers } });
  const pi = stubPi();
  const ctx = piContext(SESSION, "/repo", mode);
  squealExtension(worker.start)(pi.api);
  await pi.start("startup", ctx);
  await pi.fire("agent_settled", {}, ctx);
  return { pi, worker, ctx };
}

async function until(done: () => boolean, ms = 2_000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!done() && performance.now() < deadline) await sleep(10);
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

  it("is silent when the wait ends without news", async () => {
    const { pi, worker } = await settled("rpc", { answers: { wait: null } });
    await until(() => worker.count("wait") === 1);
    await sleep(50);
    expect(pi.sent).toEqual([]);
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
    expect(pi.sent).toEqual([]);
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
    const { pi, worker, ctx } = await settled("rpc", { sequences: { wait: [WAKE] } });
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
