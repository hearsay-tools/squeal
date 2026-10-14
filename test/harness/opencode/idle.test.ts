import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OcHooks } from "../../../src/harness/opencode/api.js";
import {
  EVENT_DEADLINE_MS,
  IDLE_DEADLINE_MS,
  IDLE_MARGIN_MS,
} from "../../../src/harness/opencode/hooks.js";
import type { OcKind } from "../../../src/harness/opencode/protocol.js";
import { tempDir } from "../../store/helpers.js";
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
 * the lookup, the Stop bridge and `promptAsync` (B1), and only the turn that
 * went idle, still live and not aborted, may be continued (B2). News a
 * cancelled continuation carried rides on the next message or tool result.
 */

const REPORT = "SQUEAL · 1 check changed (1 test) at revision 4\nPASS -> FAIL";
/** Scheduling slack on a loaded host, well under the seconds the review measured. */
const SLACK_MS = 400;

const idle = (sessionID: string) => ({
  event: { type: "session.idle", properties: { sessionID } },
});
const aborted = (sessionID: string) => ({
  event: {
    type: "session.error",
    properties: { sessionID, error: { name: "MessageAbortedError" } },
  },
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * A Stop bridge that marks its start and answers `report` only once
 * released (review 008-18 S1): the test orders what overlaps Stop by these
 * two facts, not by when independent bridge processes reach their first line.
 */
function gatedStop(report: string) {
  const dir = tempDir("squeal-oc-gate-");
  const [entry, began, gate] = ["stop.mjs", "began", "release"].map((name) => join(dir, name));
  writeFileSync(
    entry,
    `import { existsSync, readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(began)}, "");
const answer = JSON.stringify({ answer: { report: ${JSON.stringify(report)} } });
const poll = setInterval(() => {
  if (!existsSync(${JSON.stringify(gate)})) return;
  clearInterval(poll);
  process.stdout.write(answer);
}, 5);
`,
  );
  return {
    entry,
    /** Resolves once the Stop bridge runs, the idle hook awaiting it. */
    began: () => expect.poll(() => existsSync(began), { timeout: 5_000 }).toBe(true),
    release: () => writeFileSync(gate, ""),
  };
}

/** `started`, with Stop answered through `gatedStop`. */
async function startedGated() {
  const stop = gatedStop(REPORT);
  const bridge = stubBridge("answer");
  const client = stubClient();
  const hooks = await startPlugin(squealDir(), client, {
    entry: bridge.entry,
    bridge: (kind) => (kind === "stop" ? stop.entry : bridge.entry),
  });
  await hook(hooks, "event")(created(ROOT_ID));
  const kinds = () => bridge.requests().map((r) => r.kind);
  return { stop, client, hooks, kinds };
}

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

const textsOf = (parts: unknown[]) => parts.map((part) => (part as { text: string }).text);

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

describe("only the turn that went idle is continued (review 008-16 B2)", () => {
  it("an abort while Stop is pending starts no continuation; the news rides on the next message", async () => {
    const { stop, client, hooks, kinds } = await startedGated();
    await say(hooks, ROOT_ID);
    const pending = hook(hooks, "event")(idle(ROOT_ID));
    await stop.began();
    await hook(hooks, "event")(aborted(ROOT_ID));
    stop.release();
    await pending;
    expect(client.prompted).toEqual([]);
    expect(kinds()).toEqual(["register"]);
    const next = await say(hooks, ROOT_ID, "next");
    expect(textsOf(next.parts)).toEqual(["next", REPORT]);
    // Told once.
    const after = await say(hooks, ROOT_ID, "again");
    expect(textsOf(after.parts)).toEqual(["again"]);
  }, 10_000);

  it("a user message while Stop is pending starts no continuation; the news rides on the next tool result", async () => {
    const { stop, client, hooks, kinds } = await startedGated();
    await say(hooks, ROOT_ID);
    const pending = hook(hooks, "event")(idle(ROOT_ID));
    await stop.began();
    // The message completes, its own bridge call included, before Stop answers.
    expect(textsOf((await say(hooks, ROOT_ID, "next")).parts)).toEqual(["next"]);
    stop.release();
    await pending;
    expect(client.prompted).toEqual([]);
    expect(kinds()).toEqual(["register", "prompt"]);
    const output = { title: "bash", output: "done", metadata: {} };
    const call = { tool: "bash", sessionID: ROOT_ID, callID: "c1", args: {} };
    await hook(hooks, "tool.execute.after")(call, output);
    expect(output.output).toBe(`done\n\n${REPORT}`);
    const again = { title: "bash", output: "done", metadata: {} };
    await hook(hooks, "tool.execute.after")({ ...call, callID: "c2" }, again);
    expect(again.output).toBe("done");
  }, 10_000);

  it("the second idle OpenCode emits after an abort ends no turn", async () => {
    const { client, hooks, kinds } = await started({ stop: { report: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(aborted(ROOT_ID));
    await hook(hooks, "event")(idle(ROOT_ID));
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([]);
    await expect.poll(kinds).toEqual(["register", "endTurn", "wait"]);
  }, 10_000);

  it("a fresh user turn after an abort is continued again", async () => {
    const { client, hooks } = await started({ stop: { report: REPORT } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(aborted(ROOT_ID));
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([]);
    await say(hooks, ROOT_ID, "next");
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(client.prompted).toEqual([{ id: ROOT_ID, text: REPORT }]);
  }, 10_000);

  it("a continuation OpenCode refused is held for the next message; one it took late is not", async () => {
    const { client, hooks } = await started({ stop: { report: REPORT } });
    client.session.promptAsync = async () => ({ error: { name: "BusyError" } });
    await say(hooks, ROOT_ID);
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(textsOf((await say(hooks, ROOT_ID, "next")).parts)).toEqual(["next", REPORT]);
    // Taken after the deadline: it arrives as Squeal's own message, so nothing is held.
    await hook(hooks, "event")(idle(ROOT_ID));
    expect(textsOf((await say(hooks, ROOT_ID, REPORT)).parts)).toEqual([REPORT]);
    expect(textsOf((await say(hooks, ROOT_ID, "again")).parts)).toEqual(["again"]);
  }, 10_000);
});
