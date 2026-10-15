import { describe, expect, it } from "vitest";
import type { OcHooks } from "../../../src/harness/opencode/api.js";
import { IDLE_WAIT_MS } from "../../../src/harness/opencode/bridge-turn.js";
import { EVENT_DEADLINE_MS, PRIMER_CAP_CHARS } from "../../../src/harness/opencode/hooks.js";
import type { OcKind } from "../../../src/harness/opencode/protocol.js";
import { WAIT_DEADLINE_MS } from "../../../src/harness/opencode/turns.js";
import {
  alive,
  CHILD_ID,
  chatOutput,
  hook,
  PRIMER_TEXT,
  ROOT_ID,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 D3 and D5 on the plugin, with a stub bridge: the primer in every
 * request, the block by throwing and never a throw otherwise, the boundary's
 * delta in the tool result, the continuation once and never twice, none
 * after an abort, a child's consumer ended at its idle, and the idle wait
 * armed, woken, and killed by a user message and by `dispose`.
 */

const REPORT = "SQUEAL · 1 check changed (1 test) at revision 4\nPASS -> FAIL";

const event = (type: string, properties: object) => ({ event: { type, properties } });
const created = (id: string, parentID?: string) =>
  event("session.created", { info: { id, ...(parentID === undefined ? {} : { parentID }) } });
const idle = (sessionID: string) => event("session.idle", { sessionID });
const aborted = (sessionID: string) =>
  event("session.error", {
    sessionID,
    error: { name: "MessageAbortedError", data: { message: "aborted" } },
  });

async function started(answers: Partial<Record<OcKind, unknown>> = {}, behaviour?: "fail") {
  const bridge = stubBridge(behaviour ?? "answer", { answers });
  const client = stubClient();
  const hooks = await startPlugin(squealDir(), client, { entry: bridge.entry });
  await hook(hooks, "event")(created(ROOT_ID));
  await hook(hooks, "event")(created(CHILD_ID, ROOT_ID));
  const kinds = () => bridge.requests().map((r) => r.kind);
  return { bridge, client, hooks, kinds };
}

/** A user's message to `id`, its text `text`. */
const say = (hooks: OcHooks, id: string, text = "hello") => {
  const output = chatOutput(id);
  (output.parts[0] as { text: string }).text = text;
  return hook(hooks, "chat.message")({ sessionID: id }, output).then(() => output);
};

describe("experimental.chat.system.transform", () => {
  it("appends the primer from the registration to every request, capped", async () => {
    const long = `${PRIMER_TEXT}${"x".repeat(PRIMER_CAP_CHARS)}`;
    const { hooks } = await started({
      register: { header: "SQUEAL · registered", registered: true, primer: long },
    });
    const before = { system: ["OpenCode's own"] };
    await hook(hooks, "experimental.chat.system.transform")({ sessionID: ROOT_ID }, before);
    expect(before.system).toEqual(["OpenCode's own"]);
    await say(hooks, ROOT_ID);
    for (const sessionID of [ROOT_ID, CHILD_ID]) {
      const output = { system: ["OpenCode's own"] };
      await hook(hooks, "experimental.chat.system.transform")({ sessionID }, output);
      expect(output.system).toEqual(["OpenCode's own", long.slice(0, PRIMER_CAP_CHARS)]);
    }
  });

  it("takes the primer from the tool boundary that registered the consumer, with no store at the message (008-22)", async () => {
    const { bridge, hooks } = await started({
      register: { header: null, registered: false, primer: null },
      after: { text: `SQUEAL · registered\n\n${PRIMER_TEXT}`, primer: PRIMER_TEXT },
    });
    await say(hooks, ROOT_ID);
    const call = { tool: "bash", sessionID: ROOT_ID, callID: "c1", args: {} };
    await hook(hooks, "tool.execute.after")(call, { title: "bash", output: "ok", metadata: {} });
    const output = { system: ["OpenCode's own"] };
    await hook(hooks, "experimental.chat.system.transform")({ sessionID: ROOT_ID }, output);
    expect(output.system).toEqual(["OpenCode's own", PRIMER_TEXT]);
    // Asked for while the plugin has none, and not after.
    await hook(hooks, "tool.execute.after")(
      { ...call, callID: "c2" },
      { title: "bash", output: "ok", metadata: {} },
    );
    const afters = bridge.requests().filter((r) => r.kind === "after");
    expect(afters.map((r) => (r as { primer?: boolean }).primer)).toEqual([true, undefined]);
  });

  it("takes a newer primer from a registered consumer's prompt (008-22)", async () => {
    const { hooks } = await started({ prompt: { text: null, primer: "newer primer" } });
    await say(hooks, ROOT_ID);
    await say(hooks, ROOT_ID, "next");
    const output = { system: [] as string[] };
    await hook(hooks, "experimental.chat.system.transform")({ sessionID: ROOT_ID }, output);
    expect(output.system).toEqual(["newer primer"]);
  });
});

describe("tool.execute.before", () => {
  it("throws the bridge's reason, which is the block", async () => {
    const { hooks } = await started({ before: { reason: "SQUEAL · denied" } });
    await expect(
      hook(hooks, "tool.execute.before")(
        { tool: "edit", sessionID: ROOT_ID, callID: "call_1" },
        { args: {} },
      ),
    ).rejects.toThrow("SQUEAL · denied");
  });

  it("sends a bash call's command and its workdir, resolved; nothing of another tool's args", async () => {
    const { bridge, hooks } = await started();
    const call = hook(hooks, "tool.execute.before");
    await call({ tool: "bash", sessionID: ROOT_ID, callID: "c1" }, { args: { command: "ls" } });
    await call(
      { tool: "bash", sessionID: ROOT_ID, callID: "c2" },
      { args: { command: "ls", workdir: "sub" } },
    );
    await call({ tool: "write", sessionID: ROOT_ID, callID: "c3" }, { args: { command: "x" } });
    const sent = bridge.requests();
    expect(sent[0]).toMatchObject({ tool: "bash", command: "ls", workdir: expect.any(String) });
    expect((sent[1] as { workdir: string }).workdir).toBe(
      `${(sent[0] as { workdir: string }).workdir}/sub`,
    );
    expect(sent[2]).toEqual({
      kind: "before",
      tool: "write",
      consumer: { sessionId: ROOT_ID },
      worktree: expect.any(String),
      pid: process.pid,
    });
  });

  it("never throws when the bridge fails or stalls", async () => {
    const { hooks } = await started({}, "fail");
    const call = { tool: "edit", sessionID: ROOT_ID, callID: "c1" };
    await expect(hook(hooks, "tool.execute.before")(call, { args: {} })).resolves.toBe(undefined);
    const stalled = await started({ before: "stall" });
    const at = performance.now();
    await expect(hook(stalled.hooks, "tool.execute.before")(call, { args: {} })).resolves.toBe(
      undefined,
    );
    expect(performance.now() - at).toBeLessThan(EVENT_DEADLINE_MS + 500);
  }, 10_000);
});

describe("tool.execute.after", () => {
  it("appends the delta after a blank line, and nothing without one", async () => {
    const { hooks } = await started({ after: { text: REPORT } });
    const output = { title: "bash", output: "done", metadata: {} };
    await hook(hooks, "tool.execute.after")(
      { tool: "bash", sessionID: CHILD_ID, callID: "c1", args: {} },
      output,
    );
    expect(output.output).toBe(`done\n\n${REPORT}`);
    const silent = await started();
    const quiet = { title: "bash", output: "done", metadata: {} };
    await hook(silent.hooks, "tool.execute.after")(
      { tool: "bash", sessionID: ROOT_ID, callID: "c1", args: {} },
      quiet,
    );
    expect(quiet.output).toBe("done");
    expect(silent.bridge.requests()[0]).toMatchObject({ kind: "after", tool: "bash" });
  });
});

describe("a root's session.idle", () => {
  it("continues once with news; the continuation's own idle ends the turn, silent", async () => {
    const { bridge, client, hooks, kinds } = await started({ stop: { report: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([{ id: ROOT_ID, text: REPORT }]);
    // The continuation arrives as a message: Squeal's own, so the flag stays.
    await say(hooks, ROOT_ID, REPORT);
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toHaveLength(1);
    expect(kinds().filter((k) => k !== "wait")).toEqual(["register", "stop", "prompt", "endTurn"]);
    // Its own news waits for the next prompt, the wake included (lessons, defect 5).
    expect(bridge.requests().find((q) => q.kind === "endTurn")).toMatchObject({ continued: true });
    // A user's message clears it: the next idle asks Stop again.
    await say(hooks, ROOT_ID, "next");
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(kinds().filter((k) => k === "stop")).toHaveLength(2);
    expect(client.prompted).toHaveLength(2);
  });

  it("is no continuation after an abort: it ends the turn", async () => {
    const { bridge, client, hooks, kinds } = await started({ stop: { report: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(aborted(ROOT_ID));
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([]);
    await expect.poll(kinds).toEqual(["register", "endTurn", "wait"]);
    expect(bridge.requests().find((q) => q.kind === "endTurn")).not.toHaveProperty("continued");
  });

  it("ends an aborted continuation as continued: its own news waits for the next prompt (review 008-32)", async () => {
    const { bridge, client, hooks } = await started({ stop: { report: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([{ id: ROOT_ID, text: REPORT }]);
    await say(hooks, ROOT_ID, REPORT);
    await hook(hooks, "event")(aborted(ROOT_ID));
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toHaveLength(1);
    expect(bridge.requests().find((q) => q.kind === "endTurn")).toMatchObject({ continued: true });
  });

  it("arms the idle wait after a silent stop, and wakes the agent with its delta", async () => {
    const { client, hooks, kinds } = await started({ wait: { text: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(idle(ROOT_ID));
    await expect.poll(() => client.prompted).toEqual([{ id: ROOT_ID, text: REPORT }]);
    expect(kinds()).toEqual(["register", "stop", "wait"]);
    // The woken turn's idle is Squeal's own: it ends the turn and waits again.
    await say(hooks, ROOT_ID, REPORT);
    await hook(hooks, "event")(idle(ROOT_ID));
    await expect.poll(() => kinds().slice(3)).toEqual(["prompt", "endTurn", "wait"]);
  });

  it("is never thrown out of, the bridge failing", async () => {
    const { client, hooks } = await started({}, "fail");
    await expect(hook(hooks, "event")(idle(ROOT_ID))).resolves.toBe(undefined);
    expect(client.prompted).toEqual([]);
  });
});

describe("the idle wait's end", () => {
  async function waiting() {
    const run = await started({ wait: "stall" });
    await say(run.hooks, ROOT_ID);
    await hook(run.hooks, "event")(idle(ROOT_ID));
    await expect.poll(() => run.bridge.pids("wait")).toHaveLength(1);
    const [pid] = run.bridge.pids("wait");
    return { ...run, pid: pid ?? 0 };
  }

  it("a user message kills the waiter", async () => {
    const { hooks, pid } = await waiting();
    expect(alive(pid)).toBe(true);
    await say(hooks, ROOT_ID, "next");
    await expect.poll(() => alive(pid)).toBe(false);
  });

  it("dispose kills the waiter", async () => {
    const { hooks, pid } = await waiting();
    await hook(hooks, "dispose")();
    await expect.poll(() => alive(pid)).toBe(false);
  });

  it("outlasts the waiter's own bound", () => {
    expect(WAIT_DEADLINE_MS).toBeGreaterThan(IDLE_WAIT_MS);
  });
});

describe("a child's session.idle", () => {
  it("ends the child's consumer alone, asks no Stop, and a resumed child registers again", async () => {
    const { bridge, client, hooks } = await started({ stop: { report: REPORT } });
    await say(hooks, CHILD_ID);
    await hook(hooks, "event")(idle(CHILD_ID));
    expect(client.prompted).toEqual([]);
    expect(bridge.requests().map((r) => r.kind)).toEqual(["register", "end"]);
    expect(bridge.requests()[1]).toMatchObject({
      sessions: [],
      consumers: [{ sessionId: ROOT_ID, agentId: CHILD_ID }],
    });
    await say(hooks, CHILD_ID);
    expect(bridge.requests()[2]).toMatchObject({
      kind: "register",
      consumer: { sessionId: ROOT_ID, agentId: CHILD_ID },
    });
  });
});
