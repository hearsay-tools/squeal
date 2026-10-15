import { describe, expect, it } from "vitest";
import type { OcTextPartInput } from "../../../src/harness/opencode/api.js";
import { DISPOSE_DEADLINE_MS } from "../../../src/harness/opencode/hooks.js";
import type { OcKind } from "../../../src/harness/opencode/protocol.js";
import {
  chatOutput,
  created,
  hook,
  ROOT_ID,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 goal 4 and D5 under `opencode run` (008-25, lessons defect 1):
 * `run` disposes the instance about 10 ms after the turn's idle and awaits
 * `dispose` before it exits. An idle whose Stop is in flight then stores its
 * news in the session with `noReply`, read at the next `run --continue`,
 * within `dispose`'s deadline; and the plugin instance OpenCode re-creates to
 * store it leaves the stored report as it is.
 */

const REPORT = "SQUEAL · 1 check changed (1 test) at revision 4\nPASS -> FAIL";
/** Scheduling slack on a loaded host. */
const SLACK_MS = 400;
/** How long after the idle `opencode run` disposed in dogfooding (s3b: 9 ms). */
const RUN_DISPOSE_MS = 10;

const idle = { event: { type: "session.idle", properties: { sessionID: ROOT_ID } } };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A root registered, its turn open, and Stop answering `report` after `stopMs`. */
async function turnOpen(stopMs: number, report: string | null = REPORT) {
  const bridge = stubBridge("answer", {
    answers: { stop: { report } },
    delays: { stop: stopMs },
  });
  const client = stubClient();
  const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
  await hook(hooks, "event")(created(ROOT_ID));
  await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID));
  const kinds = () => bridge.requests().map((r) => r.kind);
  return { client, hooks, kinds };
}

/** The idle, not awaited, as OpenCode calls `event`, then `dispose` as `run` does; how long `dispose` took. */
async function runEnds(hooks: Awaited<ReturnType<typeof turnOpen>>["hooks"]) {
  const idling = hook(hooks, "event")(idle);
  await sleep(RUN_DISPOSE_MS);
  const at = performance.now();
  await hook(hooks, "dispose")();
  const took = performance.now() - at;
  await idling;
  return took;
}

describe("dispose right after the turn's idle (opencode run)", () => {
  it("stores the news as one synthetic message with noReply, starts no turn, then ends the consumer", async () => {
    const { client, hooks, kinds } = await turnOpen(300);
    const bodies: { parts: OcTextPartInput[]; noReply: true }[] = [];
    const prompt = client.session.prompt;
    client.session.prompt = (options) => {
      bodies.push(options.body);
      return prompt(options);
    };
    await runEnds(hooks);
    expect(client.prompted).toEqual([]);
    expect(client.stored).toEqual([{ id: ROOT_ID, text: REPORT }]);
    expect(bodies).toEqual([
      { parts: [{ type: "text", text: REPORT, synthetic: true }], noReply: true },
    ]);
    // Stop answered before the consumer ended: its report was this instance's to store.
    const sequence = kinds();
    expect(sequence.indexOf("stop")).toBeLessThan(sequence.indexOf("end"));
    expect(sequence.filter((k: OcKind) => k === "end")).toHaveLength(1);
  }, 10_000);

  it("a store OpenCode never answers is cancelled within dispose's deadline, and the consumer still ends", async () => {
    const { client, hooks, kinds } = await turnOpen(100);
    const signals: (AbortSignal | undefined)[] = [];
    client.session.prompt = (options) => {
      signals.push(options.signal);
      return new Promise(() => {});
    };
    const took = await runEnds(hooks);
    expect(took).toBeLessThan(DISPOSE_DEADLINE_MS + SLACK_MS);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(kinds()).toContain("end");
  }, 10_000);

  it("an idle with no news stores nothing", async () => {
    const { client, hooks, kinds } = await turnOpen(100, null);
    await runEnds(hooks);
    expect(client.stored).toEqual([]);
    expect(client.prompted).toEqual([]);
    expect(kinds()).toContain("end");
  }, 10_000);
});

describe("the instance OpenCode re-creates to store the report", () => {
  const stored = (text: string) => ({
    message: { id: "msg_1", sessionID: ROOT_ID },
    parts: [
      { id: "prt_1", sessionID: ROOT_ID, messageID: "msg_1", type: "text", text, synthetic: true },
    ] as unknown[],
  });

  it("adds nothing to Squeal's stored report and registers nothing", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = stored(REPORT);
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    expect(output.parts).toHaveLength(1);
    expect(bridge.requests()).toEqual([]);
  });

  it("still registers at another synthetic message, such as compaction's", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = stored("Continue if you have next steps");
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    expect(bridge.requests().map((r) => r.kind)).toEqual(["register"]);
    expect(output.parts).toHaveLength(2);
  });
});
