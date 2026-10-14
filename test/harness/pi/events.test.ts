import { describe, expect, it } from "vitest";
import {
  EVENT_DEADLINE_MS,
  PRIMER_SECTION,
  squealExtension,
} from "../../../src/harness/pi/extension.js";
import { type FakeWorkerOptions, fakeWorker } from "./fake-worker.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Spec 009 D3 and D4 for one run, on recorded event shapes: the primer and
 * the run's news, one delivery per `turn_end` with tool calls and none on the
 * final one, the block on a writer and never on `bash` by default, one
 * continuation per run, the abort's end of turn, and silence after shutdown.
 */

const SESSION = "019a0000-0000-7000-8000-000000000003";
const ctx = piContext(SESSION, "/repo");

async function started(options: FakeWorkerOptions = {}) {
  const worker = fakeWorker(options);
  const pi = stubPi();
  squealExtension(worker.start)(pi.api);
  await pi.start("startup", ctx);
  return { pi, worker };
}

const toolResults = (...names: string[]) => ({
  toolResults: names.map((toolName, i) => ({ role: "toolResult", toolName, toolCallId: `c${i}` })),
});
const prompt = (pi: ReturnType<typeof stubPi>) => {
  const event = { prompt: "go", systemPromptOptions: { sections: {} as Record<string, string> } };
  return { event, result: pi.fire("before_agent_start", event, ctx) };
};
const squealEntry = (content: string) => ({
  type: "custom_message",
  customType: "squeal",
  content,
  display: true,
});

describe("before_agent_start", () => {
  it("sets the primer section and returns the run's news as its message", async () => {
    const { pi, worker } = await started({
      answers: { run: { primer: "Squeal runs", news: "NEWS" } },
    });
    const { event, result } = prompt(pi);
    expect(await result).toEqual({
      message: { customType: "squeal", content: "NEWS", display: true },
    });
    expect(event.systemPromptOptions.sections[PRIMER_SECTION]).toBe("Squeal runs");
    expect(worker.seen.at(-1)).toEqual({ kind: "run", sessionId: SESSION, cwd: "/repo" });
  });

  it("returns no message without news", async () => {
    const { pi } = await started({ answers: { run: { primer: "Squeal runs", news: null } } });
    expect(await prompt(pi).result).toBeUndefined();
  });

  it("keeps the last primer for a run the worker gives none", async () => {
    const { pi } = await started({
      sequences: {
        run: [
          { primer: "Squeal runs", news: null },
          { primer: null, news: null },
        ],
      },
    });
    await prompt(pi).result;
    const next = prompt(pi);
    await next.result;
    expect(next.event.systemPromptOptions.sections[PRIMER_SECTION]).toBe("Squeal runs");
  });

  it("sets no primer before the worker has given one", async () => {
    const { pi } = await started({ stall: ["run"] });
    const { event, result } = prompt(pi);
    await result;
    expect(event.systemPromptOptions.sections).toEqual({});
  }, 10_000);
});

describe("turn_end", () => {
  it("delivers once after a batch of three parallel calls, as one entry", async () => {
    const { pi, worker } = await started({ answers: { boundary: "SQUEAL · FAIL" } });
    const result = await pi.fire("turn_end", toolResults("write", "bash", "read"), ctx);
    expect(result).toEqual({ entries: [squealEntry("SQUEAL · FAIL")] });
    expect(worker.count("boundary")).toBe(1);
    expect(worker.seen.at(-1)).toMatchObject({ kind: "boundary", edited: true });
  });

  it("delivers nothing on the final turn, which made no tool calls", async () => {
    const { pi, worker } = await started({ answers: { boundary: "SQUEAL · FAIL" } });
    expect(await pi.fire("turn_end", toolResults(), ctx)).toBeUndefined();
    expect(worker.count("boundary")).toBe(0);
  });

  it("says a batch of only read-only tools edited nothing", async () => {
    const { pi, worker } = await started();
    expect(await pi.fire("turn_end", toolResults("read", "grep", "ls"), ctx)).toBeUndefined();
    expect(worker.seen.at(-1)).toMatchObject({ kind: "boundary", edited: false });
  });
});

describe("tool_call", () => {
  it("blocks a writer with the worker's reason", async () => {
    const { pi, worker } = await started({ answers: { toolCall: "SQUEAL · denied" } });
    const event = { toolName: "edit", toolCallId: "c0", input: { path: "a.ts" } };
    expect(await pi.fire("tool_call", event, ctx)).toEqual({
      block: true,
      reason: "SQUEAL · denied",
    });
    expect(worker.seen.at(-1)).toEqual({
      kind: "toolCall",
      toolName: "edit",
      sessionId: SESSION,
      cwd: "/repo",
    });
  });

  it("asks about bash with its command, and lets it run on silence", async () => {
    const { pi, worker } = await started();
    const event = { toolName: "bash", toolCallId: "c0", input: { command: "npx vitest run" } };
    expect(await pi.fire("tool_call", event, ctx)).toBeUndefined();
    expect(worker.seen.at(-1)).toMatchObject({ toolName: "bash", command: "npx vitest run" });
  });

  it("asks nothing about a read-only or extension tool", async () => {
    const { pi, worker } = await started({ answers: { toolCall: "never" } });
    for (const toolName of ["read", "grep", "mcp__x__y"]) {
      expect(await pi.fire("tool_call", { toolName, input: {} }, ctx)).toBeUndefined();
    }
    expect(worker.count("toolCall")).toBe(0);
  });

  it("lets the call run when the worker misses its deadline", async () => {
    const { pi } = await started({ stall: ["toolCall"] });
    const at = performance.now();
    expect(await pi.fire("tool_call", { toolName: "write", input: {} }, ctx)).toBeUndefined();
    expect(performance.now() - at).toBeLessThan(EVENT_DEADLINE_MS + 500);
  }, 10_000);
});

describe("the end of a run", () => {
  const settle = (pi: ReturnType<typeof stubPi>, outcome = "completed") =>
    pi.fire("agent_before_settle", { outcome, entries: [], continue: false }, ctx);

  it("continues a completed run once with the report, then ends the turn at agent_settled", async () => {
    const { pi, worker } = await started({ answers: { settle: { report: "SQUEAL · FAIL" } } });
    await pi.fire("input", { text: "go", source: "rpc" }, ctx);
    expect(await settle(pi)).toEqual({ entries: [squealEntry("SQUEAL · FAIL")], continue: true });
    // The continuation's own settle: Squeal never continues a run twice.
    expect(await settle(pi)).toBeUndefined();
    await pi.fire("agent_settled", {}, ctx);
    expect(worker.count("settle")).toBe(1);
    expect(worker.count("endTurn")).toBe(1);
  });

  it("continues again in the next run, after its input", async () => {
    const { pi, worker } = await started({ answers: { settle: { report: "SQUEAL · FAIL" } } });
    await settle(pi);
    await pi.fire("agent_settled", {}, ctx);
    await pi.fire("input", { text: "again", source: "rpc" }, ctx);
    expect(await settle(pi)).toMatchObject({ continue: true });
    expect(worker.count("settle")).toBe(2);
  });

  it("is silent when Stop is, and leaves the turn ended", async () => {
    const { pi, worker } = await started({ answers: { settle: { report: null } } });
    expect(await settle(pi)).toBeUndefined();
    await pi.fire("agent_settled", {}, ctx);
    expect(worker.count("endTurn")).toBe(0);
  });

  it.each(["aborted", "error"])("asks no Stop of an %s run and ends its turn", async (outcome) => {
    const { pi, worker } = await started({ answers: { settle: { report: "never" } } });
    expect(await settle(pi, outcome)).toBeUndefined();
    await pi.fire("agent_settled", {}, ctx);
    expect(worker.count("settle")).toBe(0);
    expect(worker.count("endTurn")).toBe(1);
  });

  it("ends the turn of an abort, which fires no agent_before_settle", async () => {
    const { pi, worker } = await started();
    await pi.fire("input", { text: "go", source: "rpc" }, ctx);
    await pi.fire("agent_settled", {}, ctx);
    expect(worker.count("endTurn")).toBe(1);
  });

  it("ends the turn at agent_settled when Stop missed its deadline", async () => {
    const { pi, worker } = await started({ stall: ["settle"] });
    expect(await settle(pi)).toBeUndefined();
    await pi.fire("agent_settled", {}, ctx);
    // The stalled worker was replaced; the end of the turn went to the fresh one.
    expect(worker.count("endTurn")).toBe(1);
    expect(worker.starts()).toBe(2);
  }, 10_000);
});

describe("after session_shutdown", () => {
  it("every event is silent and asks the worker nothing", async () => {
    const { pi, worker } = await started({
      answers: {
        run: { primer: "P", news: "N" },
        boundary: "B",
        toolCall: "T",
        settle: { report: "S" },
      },
    });
    await pi.shutdown("quit", ctx);
    const before = worker.seen.length;
    const { event, result } = prompt(pi);
    expect(await result).toBeUndefined();
    expect(event.systemPromptOptions.sections).toEqual({});
    expect(await pi.fire("turn_end", toolResults("write"), ctx)).toBeUndefined();
    expect(await pi.fire("tool_call", { toolName: "edit", input: {} }, ctx)).toBeUndefined();
    // Closing RPC stdin mid-run fires agent_before_settle after shutdown (research, events 4).
    expect(
      await pi.fire("agent_before_settle", { outcome: "completed", entries: [] }, ctx),
    ).toBeUndefined();
    await pi.fire("agent_settled", {}, ctx);
    expect(worker.seen.length).toBe(before);
  });

  it("no handler throws on a stale context", async () => {
    const { pi } = await started({ answers: { boundary: "B" } });
    const stale = piContext(() => {
      throw new Error("stale");
    });
    await expect(pi.fire("turn_end", toolResults("write"), stale)).resolves.toBeUndefined();
    await expect(
      pi.fire("tool_call", { toolName: "edit", input: {} }, stale),
    ).resolves.toBeUndefined();
    await expect(pi.fire("agent_settled", {}, stale)).resolves.toBeUndefined();
  });
});
