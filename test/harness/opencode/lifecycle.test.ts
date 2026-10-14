import { describe, expect, it } from "vitest";
import { DISPOSE_DEADLINE_MS } from "../../../src/harness/opencode/plugin.js";
import {
  CHILD_ID,
  chatOutput,
  created,
  deleted,
  hook,
  ROOT_ID,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 D3's ends of a consumer on the plugin: `session.deleted` of a
 * root and of a child, and `dispose`, after which every hook is silent.
 */

describe("session.deleted and dispose", () => {
  async function registeredRootAndChild() {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    await hook(hooks, "event")(created(CHILD_ID, ROOT_ID));
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID));
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, chatOutput(CHILD_ID));
    const ends = () => bridge.requests().filter((r) => r.kind === "end");
    return { hooks, ends };
  }

  it("session.deleted of a root ends its session whole", async () => {
    const { hooks, ends } = await registeredRootAndChild();
    await hook(hooks, "event")(deleted(ROOT_ID));
    expect(ends()).toMatchObject([{ sessions: [ROOT_ID], consumers: [] }]);
    // Nothing is left for dispose to unregister.
    await hook(hooks, "dispose")();
    expect(ends()).toHaveLength(1);
  });

  it("session.deleted of a child unregisters its consumer alone", async () => {
    const { hooks, ends } = await registeredRootAndChild();
    await hook(hooks, "event")(deleted(CHILD_ID, ROOT_ID));
    expect(ends()).toMatchObject([
      { sessions: [], consumers: [{ sessionId: ROOT_ID, agentId: CHILD_ID }] },
    ]);
  });

  it("dispose unregisters what this instance registered, once, then every hook is silent", async () => {
    const { hooks, ends } = await registeredRootAndChild();
    await hook(hooks, "dispose")();
    await hook(hooks, "dispose")();
    expect(ends()).toMatchObject([
      {
        sessions: [],
        consumers: [{ sessionId: ROOT_ID }, { sessionId: ROOT_ID, agentId: CHILD_ID }],
      },
    ]);
    const output = chatOutput("ses_new");
    await hook(hooks, "chat.message")({ sessionID: "ses_new" }, output);
    expect(output.parts).toHaveLength(1);
    // Review 008-15 N1: shell.env too.
    const shell = { env: {} as Record<string, string> };
    await hook(hooks, "shell.env")({ cwd: "/", sessionID: ROOT_ID }, shell);
    expect(shell.env).toEqual({});
    expect(ends()).toHaveLength(1);
  });

  it("dispose waits for a registration in flight and unregisters it (review 008-15 S1)", async () => {
    const bridge = stubBridge("answer", { delays: { register: 800 } });
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = chatOutput(ROOT_ID);
    const message = hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    await new Promise((done) => setTimeout(done, 200));
    const started = performance.now();
    await hook(hooks, "dispose")();
    expect(performance.now() - started).toBeLessThan(DISPOSE_DEADLINE_MS);
    await message;
    expect(bridge.requests().filter((r) => r.kind === "end")).toMatchObject([
      { sessions: [], consumers: [{ sessionId: ROOT_ID }] },
    ]);
    // Disposed before it answered: nothing is added to the message.
    expect(output.parts).toHaveLength(1);
  }, 10_000);

  it("dispose during the identity lookup leaves no registration behind (review 008-16 S1)", async () => {
    const bridge = stubBridge();
    const client = stubClient([{ id: ROOT_ID }]);
    const get = client.session.get;
    client.session.get = (options) =>
      new Promise((done) => setTimeout(() => done(get(options)), 800));
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    const output = chatOutput(ROOT_ID);
    const message = hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    await new Promise((done) => setTimeout(done, 200));
    await hook(hooks, "dispose")();
    await message;
    expect(bridge.requests()).toEqual([]);
    expect(output.parts).toHaveLength(1);
  }, 10_000);

  it("dispose with nothing registered starts no bridge", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "dispose")();
    expect(bridge.requests()).toEqual([]);
  });
});
