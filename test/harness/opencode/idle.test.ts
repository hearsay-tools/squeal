import { describe, expect, it } from "vitest";
import type { OcHooks } from "../../../src/harness/opencode/api.js";
import {
  EVENT_DEADLINE_MS,
  IDLE_DEADLINE_MS,
  IDLE_MARGIN_MS,
} from "../../../src/harness/opencode/hooks.js";
import type { OcKind } from "../../../src/harness/opencode/protocol.js";
import {
  CHILD_ID,
  chatOutput,
  created,
  deleted,
  hook,
  ROOT_ID,
  STUB_ANSWERS,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 D3 and D4 at a root's idle, review 008-16: one deadline bounds
 * the lookup, the Stop bridge and `promptAsync` (B1).
 */

const REPORT = "SQUEAL · 1 check changed (1 test) at revision 4\nPASS -> FAIL";
/** Scheduling slack on a loaded host, well under the seconds the review measured. */
const SLACK_MS = 400;

const idle = (sessionID: string) => ({
  event: { type: "session.idle", properties: { sessionID } },
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function started(
  answers: Partial<Record<OcKind, unknown>>,
  delays: Partial<Record<OcKind, number>> = {},
) {
  const bridge = stubBridge("answer", { answers, delays });
  const client = stubClient();
  const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
  await hook(hooks, "event")(created(ROOT_ID));
  const kinds = () => bridge.requests().map((r) => r.kind);
  return { bridge, client, hooks, kinds };
}

/** A user's message to `id`, its text `text`; its output. */
const say = async (hooks: OcHooks, id: string, text = "hello") => {
  const output = chatOutput(id);
  (output.parts[0] as { text: string }).text = text;
  await hook(hooks, "chat.message")({ sessionID: id }, output);
  return output;
};


describe("one deadline at idle (review 008-16 B1)", () => {
  it("a slow Stop then a stalled promptAsync: the hook returns within its bound and cancels the request", async () => {
    const { client, hooks } = await started({ stop: { report: REPORT } }, { stop: 1_000 });
    const signals: (AbortSignal | undefined)[] = [];
    client.session.promptAsync = (options) => {
      signals.push(options.signal);
      return new Promise(() => {});
    };
    await say(hooks, ROOT_ID);
    const at = performance.now();
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(performance.now() - at).toBeLessThan(IDLE_DEADLINE_MS + SLACK_MS);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  }, 10_000);

  it("is the configured stop.waitMs plus 500 ms, not the longest", async () => {
    const { client, hooks } = await started(
      {
        register: { ...(STUB_ANSWERS.register as object), stopWaitMs: 0 },
        stop: { report: REPORT },
      },
      { stop: 1_000 },
    );
    await say(hooks, ROOT_ID);
    const at = performance.now();
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(performance.now() - at).toBeLessThan(IDLE_MARGIN_MS + SLACK_MS);
    // The Stop missed the bound: silence, and no late continuation.
    await sleep(1_000);
    expect(client.prompted).toEqual([]);
  }, 10_000);

  it("deletion spends one deadline over a delayed ancestry and a stalled end", async () => {
    const bridge = stubBridge("answer", { answers: { end: "stall" } });
    const client = stubClient([{ id: ROOT_ID }]);
    const get = client.session.get;
    client.session.get = (options) =>
      new Promise((done) => setTimeout(() => done(get(options)), 800));
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    const at = performance.now();
    await hook(hooks, "event")(deleted(CHILD_ID, ROOT_ID));
    expect(performance.now() - at).toBeLessThan(EVENT_DEADLINE_MS + SLACK_MS);
    expect(bridge.requests()).toMatchObject([
      { kind: "end", consumers: [{ sessionId: ROOT_ID, agentId: CHILD_ID }] },
    ]);
  }, 10_000);
});
