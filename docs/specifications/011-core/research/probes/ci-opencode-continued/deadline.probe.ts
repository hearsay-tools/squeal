// Throwaway diagnosis. Only the private built bridge is wrapped; product files are untouched.
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { readTurn } from "../../../../../../src/core/delivery/turn.js";
import { PLANNED_MODEL } from "../../../../../../test/fixtures/opencode/scripted-provider.js";
import { buildOpencodeBundles } from "../../../../../../test/harness/opencode/helpers.js";
import { squealOpenCode } from "../../../../../../test/harness/opencode/real.js";
import { textOf } from "../../../../../../test/helpers/opencode.js";
import { tempDir } from "../../../../../../test/store/helpers.js";

for (const mode of ["normal", "before-handler", "after-handler"] as const) {
  it(`traces the first idle: ${mode}`, { timeout: 120_000 }, async () => {
    const built = await buildOpencodeBundles();
    const trace = join(tempDir("sq-oc-trace-"), "trace.jsonl");
    const log = (event: string, detail: unknown = null) => appendFileSync(trace,
      JSON.stringify({ at: Date.now(), event, detail }) + "\n");
    const shim = join(tempDir("sq-oc-shim-"), "squeal.js");
    const marker = `const log=(event,detail=null)=>appendFileSync(${JSON.stringify(trace)},JSON.stringify({at:Date.now(),event,detail})+'\\n');`;
    writeFileSync(shim, `import {appendFileSync} from 'node:fs';
import mod from ${JSON.stringify(join(built.dir, "plugin.mjs"))};
${marker}
export const Squeal = async (input) => {
  const original = input.client.session.promptAsync.bind(input.client.session);
  input.client.session.promptAsync = async (...args) => {
    log('promptAsync-enter');
    const answer=await original(...args);
    log('promptAsync-exit', {error: answer.error ?? null});
    return answer;
  };
  const hooks = await mod.server(input);
  return {...hooks, async event(arg) {
    const type=arg.event.type;
    if(type==='session.idle') log('idle-enter');
    await hooks.event?.(arg);
    if(type==='session.idle') log('idle-exit');
  }, async 'chat.message'(input, output) {
    log('chat-enter');
    await hooks['chat.message']?.(input, output);
    log('chat-exit');
  }};
};`);
    const stop = join(built.dir, "hooks", "stop.mjs");
    renameSync(stop, join(built.dir, "hooks", "stop-real.mjs"));
    writeFileSync(stop, `import {appendFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
${marker}
log('stop-enter');
${mode === "before-handler" ? "await sleep(700);" : ""}
const write=process.stdout.write.bind(process.stdout);
process.stdout.write=(chunk,...args)=>{
  log('stop-answer-ready', JSON.parse(String(chunk)));
  ${mode === "after-handler" ? "setTimeout(()=>write(chunk,...args),700); return true;" : "return write(chunk,...args);"}
};
await import('./stop-real.mjs');
`);
    let cleanup: (() => void) | undefined;
    try {
      const result = await squealOpenCode({
        dist: built.dir, plugin: shim, mode: "serve", prompt: "edit", timeoutMs: 90_000,
        plan: [{ text: "done", delayMs: 1_500 }, { text: "noted" }, { text: "extra" }],
        onRegistered: (r) => { r.apply(r.fail()); log("failure-applied"); },
        afterReply: async (live, r) => {
          log("after-first-reply");
          const planned = () => live.requests.filter(q => q.model === PLANNED_MODEL);
          if (mode === "normal") {
            await expect.poll(() => planned().length, { timeout: 30_000 }).toBe(2);
            log("continuation-seen");
            expect(textOf(planned()[1]?.messages.at(-1))).toContain("PASS -> FAIL");
          } else {
            let countFailure: unknown;
            try {
              await expect.poll(() => planned().length, { timeout: 30_000 }).toBe(2);
            } catch (error) { countFailure = error; }
            expect(countFailure).toBeDefined();
            const consumer = r.store.consumers.list(r.worktreeId)[0]?.consumer;
            if (!consumer) throw new Error("no consumer");
            log("poll-expired", {
              count: planned().length,
              turn: readTurn(r.store, consumer),
              view: r.store.views.list(consumer).map(v => ({ outcome: v.outcome })),
              state: r.store.knownStates.list(r.worktreeId).map(s => ({ outcome: s.outcome })),
            });
            await live.message("anything new?");
            const next = textOf(planned()[1]?.messages.at(-1));
            log("next-user-received", { transition: next.includes("PASS -> FAIL") });
            expect(next.includes("PASS -> FAIL")).toBe(mode === "before-handler");
          }
          await sleep(100);
        },
      });
      cleanup = result.run.cleanup;
    } finally {
      console.log(`TRACE ${mode}\n${readFileSync(trace, "utf8")}`);
      cleanup?.();
      built.cleanup();
    }
  });
}
