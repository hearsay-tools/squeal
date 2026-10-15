import { describe, expect, it } from "vitest";
import type { OcHooks } from "../../../src/harness/opencode/api.js";
import { DISPOSE_DEADLINE_MS } from "../../../src/harness/opencode/hooks.js";
import {
  chatOutput,
  created,
  hook,
  MESSAGE_ID,
  ROOT_ID,
  type StubClient,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Review 008-27 B1: an idle whose Stop is in flight at `dispose` stores its
 * news (`run-end.test.ts`) only for the turn that went idle. Input or an
 * abort that comes meanwhile, which OpenCode routes to the instance it
 * re-creates, or a newer message OpenCode holds, leaves nothing stored, and
 * so does a read of the session's messages that fails. Stop answers after
 * `STOP_MS`, so what `during` does comes first.
 */

const REPORT = "SQUEAL · 1 check changed (1 test) at revision 4\nPASS -> FAIL";
const STOP_MS = 300;
/** Scheduling slack on a loaded host. */
const SLACK_MS = 400;

const idle = { event: { type: "session.idle", properties: { sessionID: ROOT_ID } } };
const abort = {
  event: {
    type: "session.error",
    properties: { sessionID: ROOT_ID, error: { name: "MessageAbortedError" } },
  },
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** An instance on `client` whose root is registered and its turn open. */
async function instance(client: StubClient): Promise<OcHooks> {
  const bridge = stubBridge("answer", {
    answers: { stop: { report: REPORT } },
    delays: { stop: STOP_MS },
  });
  const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
  await hook(hooks, "event")(created(ROOT_ID));
  await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID));
  return hooks;
}

/** The turn's idle, then `dispose` as `opencode run` calls it, with `during` once it began; how long `dispose` took. */
async function disposing(hooks: OcHooks, during: () => Promise<void> | void): Promise<number> {
  const idling = hook(hooks, "event")(idle);
  await sleep(10);
  const at = performance.now();
  const disposed = hook(hooks, "dispose")().then(() => performance.now() - at);
  await during();
  const took = await disposed;
  await idling;
  return took;
}

describe("an idle storing its news at dispose, overtaken (review 008-27 B1)", () => {
  it("stores nothing after new input that reached the instance OpenCode re-created", async () => {
    const client = stubClient();
    const old = await instance(client);
    const fresh = await instance(stubClient());
    await disposing(old, () => {
      void hook(fresh, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID, "msg_2"));
    });
    expect(client.stored).toEqual([]);
    expect(client.prompted).toEqual([]);
  }, 10_000);

  it("stores nothing after an abort that reached the instance OpenCode re-created", async () => {
    const client = stubClient();
    const old = await instance(client);
    const fresh = await instance(stubClient());
    await disposing(old, () => {
      void hook(fresh, "event")(abort);
    });
    expect(client.stored).toEqual([]);
  }, 10_000);

  it("stores nothing when OpenCode holds a newer message than the turn's", async () => {
    const client = stubClient();
    const old = await instance(client);
    await disposing(old, () => {
      client.history.push({ id: "msg_2", role: "user" });
    });
    expect(client.stored).toEqual([]);
  }, 10_000);

  it("stores nothing when the read of the session's messages fails", async () => {
    const client = stubClient();
    client.session.messages = async () => ({ error: { name: "UnknownError" } });
    await disposing(await instance(client), () => {});
    expect(client.stored).toEqual([]);
  }, 10_000);

  it("cancels a read OpenCode never answers within dispose's deadline, storing nothing", async () => {
    const client = stubClient();
    const signals: (AbortSignal | undefined)[] = [];
    client.session.messages = (options) => {
      signals.push(options.signal);
      return new Promise(() => {});
    };
    const took = await disposing(await instance(client), () => {});
    expect(took).toBeLessThan(DISPOSE_DEADLINE_MS + SLACK_MS);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(client.stored).toEqual([]);
  }, 10_000);

  it("still stores when the newest message is the turn's reply, read as the newest one", async () => {
    const client = stubClient();
    const limits: number[] = [];
    const messages = client.session.messages;
    client.session.messages = (options) => {
      limits.push(options.query.limit);
      return messages(options);
    };
    client.history.push({ id: "msg_2", role: "assistant", parentID: MESSAGE_ID });
    await disposing(await instance(client), () => {});
    expect(client.stored).toEqual([{ id: ROOT_ID, text: REPORT }]);
    expect(limits).toEqual([1]);
  }, 10_000);
});
