import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OcHooks } from "../../../src/harness/opencode/api.js";
import { EVENT_DEADLINE_MS, NO_NODE_LOG, partId } from "../../../src/harness/opencode/plugin.js";
import { tempDir } from "../../store/helpers.js";
import { outsideGit } from "../bundle-helpers.js";
import {
  CHILD_ID,
  chatOutput,
  HEADER,
  ROOT_ID,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 D2, D3 (registration, `session.deleted`, `dispose`) and D4 on the
 * plugin: the fast path, the session map, one registration per consumer, the
 * agent shell's identity, and silence on every failure.
 */

const created = (id: string, parentID?: string) => ({
  event: {
    type: "session.created",
    properties: { info: { id, ...(parentID === undefined ? {} : { parentID }) } },
  },
});
const deleted = (id: string, parentID?: string) => ({
  event: {
    type: "session.deleted",
    properties: { info: { id, ...(parentID === undefined ? {} : { parentID }) } },
  },
});

/** Calls a hook the plugin must have returned. */
function hook<K extends keyof OcHooks>(hooks: OcHooks, name: K): NonNullable<OcHooks[K]> {
  const fn = hooks[name];
  if (fn === undefined) throw new Error(`no ${name} hook`);
  return fn;
}

describe("the fast path", () => {
  it("returns no hooks outside a git worktree, without looking for Node", async () => {
    let looked = false;
    const hooks = await startPlugin(outsideGit(), stubClient(), {
      entry: stubBridge().entry,
      findNode: async () => {
        looked = true;
        return process.execPath;
      },
    });
    expect(hooks).toEqual({});
    expect(looked).toBe(false);
  });

  it("returns no hooks in a git repository with neither a config nor a store", async () => {
    const dir = tempDir("squeal-oc-plain-");
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "sub"));
    expect(
      await startPlugin(join(dir, "sub"), stubClient(), { entry: stubBridge().entry }),
    ).toEqual({});
  });

  it("returns hooks where a config is found", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    expect(Object.keys(hooks).sort()).toEqual(["chat.message", "dispose", "event", "shell.env"]);
  });

  it("returns no hooks without a Node, and logs one line through the client", async () => {
    const client = stubClient();
    const hooks = await startPlugin(squealDir(), client, {
      entry: stubBridge().entry,
      findNode: async () => null,
    });
    expect(hooks).toEqual({});
    expect(client.logged).toEqual([NO_NODE_LOG]);
  });
});

describe("chat.message", () => {
  it("registers a root once, as (session, main), and adds the header as one synthetic part", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const first = chatOutput(ROOT_ID);
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, first);
    const second = chatOutput(ROOT_ID, "msg_2");
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, second);

    expect(bridge.requests()).toEqual([
      {
        kind: "register",
        consumer: { sessionId: ROOT_ID },
        worktree: expect.any(String),
        pid: process.pid,
      },
    ]);
    expect(first.parts).toHaveLength(2);
    expect(first.parts[1]).toMatchObject({
      type: "text",
      text: HEADER,
      synthetic: true,
      sessionID: ROOT_ID,
      messageID: first.message.id,
    });
    expect(second.parts).toHaveLength(1);
  });

  it("registers a child as (root, child), from session.created", async () => {
    const bridge = stubBridge();
    const client = stubClient();
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    await hook(hooks, "event")(created(CHILD_ID, ROOT_ID));
    await hook(hooks, "chat.message")(
      { sessionID: CHILD_ID, agent: "general" },
      chatOutput(CHILD_ID),
    );
    expect(bridge.requests().map((r) => r.kind === "register" && r.consumer)).toEqual([
      { sessionId: ROOT_ID, agentId: CHILD_ID },
    ]);
    expect(client.lookups).toEqual([]);
  });

  it("looks up a session it never saw created (a resume) once, through the client", async () => {
    const bridge = stubBridge();
    const client = stubClient([{ id: ROOT_ID }, { id: CHILD_ID, parentID: ROOT_ID }]);
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, chatOutput(CHILD_ID));
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, chatOutput(CHILD_ID));
    expect(bridge.requests()).toHaveLength(1);
    expect(bridge.requests()[0]).toMatchObject({
      consumer: { sessionId: ROOT_ID, agentId: CHILD_ID },
    });
    expect(client.lookups).toEqual([CHILD_ID, ROOT_ID]);
  });

  it("registers concurrent first messages of one consumer once", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const outputs = [chatOutput(ROOT_ID), chatOutput(ROOT_ID, "msg_2")];
    await Promise.all(outputs.map((o) => hook(hooks, "chat.message")({ sessionID: ROOT_ID }, o)));
    expect(bridge.requests()).toHaveLength(1);
    expect(outputs.map((o) => o.parts.length).sort()).toEqual([1, 2]);
  });

  it("is silent within its deadline when the bridge stalls, and tries again at the next message", async () => {
    const bridge = stubBridge("stall");
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = chatOutput(ROOT_ID);
    const started = performance.now();
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    expect(performance.now() - started).toBeLessThan(EVENT_DEADLINE_MS + 500);
    expect(output.parts).toHaveLength(1);
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID));
    expect(bridge.requests()).toHaveLength(2);
  }, 10_000);

  it("holds OpenCode no longer than one deadline when both the lookup and the bridge stall (review 008-15)", async () => {
    const bridge = stubBridge("stall");
    const client = stubClient();
    client.session.get = () => new Promise(() => {});
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    const output = chatOutput(CHILD_ID);
    const started = performance.now();
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, output);
    expect(performance.now() - started).toBeLessThan(EVENT_DEADLINE_MS + 500);
    expect(output.parts).toHaveLength(1);
  }, 10_000);

  it("asks no bridge once a stalled lookup has spent the deadline", async () => {
    const bridge = stubBridge();
    const client = stubClient();
    client.session.get = () => new Promise(() => {});
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    const output = chatOutput(CHILD_ID);
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, output);
    expect(output.parts).toHaveLength(1);
    expect(bridge.requests()).toEqual([]);
  }, 10_000);

  it("never guesses a root when the lookup fails, and looks up again at the next message (review 008-15)", async () => {
    const bridge = stubBridge();
    const client = stubClient([{ id: ROOT_ID }, { id: CHILD_ID, parentID: ROOT_ID }]);
    const get = client.session.get;
    client.session.get = async () => {
      throw new Error("server busy");
    };
    const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
    const first = chatOutput(CHILD_ID);
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, first);
    const env = { env: {} as Record<string, string> };
    await hook(hooks, "shell.env")({ cwd: "/", sessionID: CHILD_ID }, env);
    expect(first.parts).toHaveLength(1);
    expect(bridge.requests()).toEqual([]);
    expect(env.env).toEqual({ PATH: "/pkg/bin:/usr/bin" });

    client.session.get = get;
    await hook(hooks, "chat.message")({ sessionID: CHILD_ID }, chatOutput(CHILD_ID));
    expect(bridge.requests().map((r) => r.kind === "register" && r.consumer)).toEqual([
      { sessionId: ROOT_ID, agentId: CHILD_ID },
    ]);
  });

  it("registers again at the next message when the bridge wrote no consumer (review 008-15)", async () => {
    const bridge = stubBridge("unregistered");
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const first = chatOutput(ROOT_ID);
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, first);
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, chatOutput(ROOT_ID, "msg_2"));
    expect(first.parts).toHaveLength(1);
    expect(bridge.requests().map((r) => r.kind)).toEqual(["register", "register"]);
    // Nothing registered, so nothing for dispose to end.
    await hook(hooks, "dispose")();
    expect(bridge.requests()).toHaveLength(2);
  });

  it("never throws: a failing bridge, a rejecting client, a frozen output", async () => {
    const client = stubClient();
    client.session.get = async () => {
      throw new Error("server gone");
    };
    const failing = await startPlugin(squealDir(), client, { entry: stubBridge("fail").entry });
    const output = chatOutput(ROOT_ID);
    await expect(hook(failing, "chat.message")({ sessionID: ROOT_ID }, output)).resolves.toBe(
      undefined,
    );
    expect(output.parts).toHaveLength(1);
    const answering = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    const frozen = {
      message: { id: "m", sessionID: ROOT_ID },
      parts: Object.freeze([]) as unknown as unknown[],
    };
    await expect(hook(answering, "chat.message")({ sessionID: ROOT_ID }, frozen)).resolves.toBe(
      undefined,
    );
  });
});

describe("shell.env", () => {
  it("names the root's consumer and puts the package's bin/ first on PATH", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = { env: {} as Record<string, string> };
    await hook(hooks, "shell.env")({ cwd: "/", sessionID: ROOT_ID, callID: "call_1" }, output);
    expect(output.env).toEqual({
      PATH: "/pkg/bin:/usr/bin",
      OPENCODE_SESSION_ID: ROOT_ID,
      OPENCODE_AGENT_ID: "main",
    });
  });

  it("names a child's consumer by its root, and keeps a PATH another plugin set", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    await hook(hooks, "event")(created(ROOT_ID));
    await hook(hooks, "event")(created(CHILD_ID, ROOT_ID));
    const output = { env: { PATH: "/other/bin:/usr/bin" } as Record<string, string> };
    await hook(hooks, "shell.env")({ cwd: "/", sessionID: CHILD_ID }, output);
    expect(output.env).toEqual({
      PATH: "/pkg/bin:/other/bin:/usr/bin",
      OPENCODE_SESSION_ID: ROOT_ID,
      OPENCODE_AGENT_ID: CHILD_ID,
    });
  });

  it("sets only PATH without a session id", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    const output = { env: {} as Record<string, string> };
    await hook(hooks, "shell.env")({ cwd: "/" }, output);
    expect(output.env).toEqual({ PATH: "/pkg/bin:/usr/bin" });
  });
});

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
    expect(ends()).toHaveLength(1);
  });

  it("dispose with nothing registered starts no bridge", async () => {
    const bridge = stubBridge();
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: bridge.entry });
    await hook(hooks, "dispose")();
    expect(bridge.requests()).toEqual([]);
  });
});

describe("partId", () => {
  it("is an ascending OpenCode part id for the time given", () => {
    const id = partId(1_791_991_860_085);
    expect(id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(id.slice(0, 16) > partId(1_791_991_860_084).slice(0, 16)).toBe(true);
  });
});

describe("a config found below the repository root", () => {
  it("counts: the walk up checks the worktree root", async () => {
    const dir = tempDir("squeal-oc-sub-");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "squeal.config.json"), "{}\n");
    mkdirSync(join(dir, "pkg"));
    const hooks = await startPlugin(join(dir, "pkg"), stubClient(), { entry: stubBridge().entry });
    expect(hooks).not.toEqual({});
  });
});
