import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel, type Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { PRIMER_SECTION, squealExtension } from "../../../src/harness/pi/extension.js";
import { serve, workerDeps } from "../../../src/harness/pi/worker.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../../src/harness/shared/primer.js";
import { fakeRepo } from "../../status/helpers.js";
import { SESSION, squealRepo } from "../helpers.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Review 0.1.556 B1: the whole Pi event sequence, on the real extension and the real worker's
 * handlers (in this thread, over a message channel). A store that comes after the run's start
 * gave that run no system primer, so the tool boundary that registers says it; a store there at
 * the start puts it in the system prompt alone. The primer, the header and the failure each
 * reach the agent once.
 */

const deps: HookDeps = {
  ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
  env: {},
  ensureDaemon: async () => "alive",
};

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The worker of `serve` in this thread: answers commit before they are posted (no verdict slot). */
function inThread(): Worker {
  const channel = new MessageChannel();
  channels.push(channel);
  serve(channel.port2, deps);
  return Object.assign(channel.port1, { terminate: async () => 0 }) as unknown as Worker;
}

const timesIn = (text: string, part: string) => text.split(part).length - 1;
const toolTurn = { toolResults: [{ role: "toolResult", toolName: "bash", toolCallId: "c0" }] };

async function session(cwd: string) {
  const pi = stubPi();
  squealExtension(inThread)(pi.api);
  const ctx = piContext(SESSION, cwd);
  await pi.start("startup", ctx);
  const run = async () => {
    const event = { prompt: "go", systemPromptOptions: { sections: {} as Record<string, string> } };
    const result = (await pi.fire("before_agent_start", event, ctx)) as
      | { message: { content: string } }
      | undefined;
    return { section: event.systemPromptOptions.sections[PRIMER_SECTION], news: result?.message };
  };
  const boundary = async () => {
    const result = (await pi.fire("turn_end", toolTurn, ctx)) as
      | { entries: { content: string }[] }
      | undefined;
    return result?.entries.map((entry) => entry.content).join("\n") ?? "";
  };
  return { pi, run, boundary };
}

describe("Pi's primer when the store comes after the run's start (review 0.1.556 B1)", () => {
  it("the boundary that registers says the primer and the failure once; the next says nothing", async () => {
    const repo = fakeRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    const s = await session(repo.main);
    expect(s.pi.sent).toEqual([]);
    const first = await s.run();
    expect(first.section).toBeUndefined();
    const r = squealRepo(repo);
    r.apply(r.fail());
    const text = await s.boundary();
    expect(timesIn(text, PRIMER_OPENING)).toBe(1);
    expect(timesIn(text, "registered at revision")).toBe(1);
    expect(timesIn(text, "FAIL")).toBe(1);
    expect(await s.boundary()).toBe("");
    // The next run's system prompt has the primer; its news repeats neither it nor the header.
    const next = await s.run();
    expect(next.section?.startsWith(PRIMER_OPENING)).toBe(true);
    expect(next.news).toBeUndefined();
  });

  it("with the store there at the start, the primer is in the system prompt alone", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const s = await session(r.root);
    const header = s.pi.sent.map((sent) => sent.message.content).join("\n");
    expect(timesIn(header, "FAIL")).toBe(1);
    expect(header).not.toContain(PRIMER_OPENING);
    const first = await s.run();
    expect(first.section?.startsWith(PRIMER_OPENING)).toBe(true);
    expect(await s.boundary()).toBe("");
  });
});
