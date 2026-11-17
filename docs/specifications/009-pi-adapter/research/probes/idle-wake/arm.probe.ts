// Throwaway probe (see README.md): the real Pi host and delivery worker bundle, driven by a
// stub Pi through one run, then `agent_settled`; measures when the wake holds its waiter lock.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { MessageChannel, Worker } from "node:worker_threads";
import { afterAll, beforeAll, expect, it } from "vitest";
import { storePaths } from "../../../../../../src/core/store/paths.js";
import { waiterLockState } from "../../../../../../src/core/waiter-lock/waiter-lock.js";
import { squealExtension } from "../../../../../../src/harness/pi/extension.js";
import { squealRepo } from "../../../../../../test/harness/helpers.js";
import { buildPiBundles } from "../../../../../../test/harness/pi/helpers.js";
import { piContext, stubPi } from "../../../../../../test/harness/pi/stub-pi.js";

let dir = "";
let cleanup = () => {};
beforeAll(async () => {
  const built = await buildPiBundles();
  dir = built.dir;
  cleanup = built.cleanup;
}, 120_000);
afterAll(() => cleanup());

const SESSION = "019a0000-0000-7000-8000-0000000000a1";
const CASES = (process.env.ARM_CASES ?? "none,start,run,boundary,settle,endTurn").split(",");
const DELAY_MS = Number(process.env.ARM_DELAY_MS ?? 2_500);

it.each(CASES)("arm with the %s answer late", { timeout: 60_000 }, async (delayKind) => {
  const r = squealRepo();
  r.apply(r.pass());
  const events: string[] = [];
  const t0 = performance.now();
  const stamp = (text: string) => events.push(`${(performance.now() - t0).toFixed(0)} ms ${text}`);
  const workers: Worker[] = [];
  const start = (verdicts: SharedArrayBuffer) => {
    const { port1, port2 } = new MessageChannel();
    port1.on("message", (m) => stamp(`worker ${workers.length} ${JSON.stringify(m).slice(0, 160)}`));
    port1.unref();
    const worker = new Worker(new URL("./delay-worker.mjs", import.meta.url), {
      execArgv: ["--disable-warning=ExperimentalWarning"],
      workerData: {
        verdicts,
        real: join(dir, "worker.mjs"),
        delayKind,
        delayMs: DELAY_MS,
        // ARM_EXIT names a request kind the first worker dies on (one death only).
        exitOn: workers.length === 0 ? process.env.ARM_EXIT : undefined,
        log: port2,
      },
      transferList: [port2],
    });
    workers.push(worker);
    stamp(`worker ${workers.length} started`);
    worker.on("exit", () => stamp(`worker ${workers.indexOf(worker) + 1} exited`));
    return worker;
  };
  const pi = stubPi();
  const ctx = piContext(SESSION, r.root, "rpc");
  squealExtension(start)(pi.api);
  const fire = async (type: string, event: object) => {
    const answer = await pi.fire(type, event, ctx);
    stamp(`${type} returned ${JSON.stringify(answer ?? null).slice(0, 80)}`);
  };
  await fire("session_start", { reason: "startup" });
  await fire("before_agent_start", { prompt: "work", systemPromptOptions: { sections: {} } });
  await fire("tool_call", { toolName: "write", input: { path: "out.txt" } });
  r.queue("k2");
  await fire("turn_end", { toolResults: [{ toolName: "write" }] });
  await fire("agent_before_settle", { outcome: "completed" });
  await fire("agent_settled", {});
  const consumer = r.store.consumers.list(r.worktreeId)[0]?.consumer;
  const locks = storePaths(r.repo.commonDir).locksDir;
  const settled = performance.now();
  let held: number | null = null;
  while (performance.now() - settled < 10_000) {
    if (consumer !== undefined && waiterLockState(locks, consumer) === "held") {
      held = performance.now() - settled;
      break;
    }
    await sleep(20);
  }
  stamp(held === null ? "never held in 10 s" : `held ${held.toFixed(0)} ms after agent_settled`);
  r.apply(r.fail());
  await sleep(held === null ? 0 : 3_000);
  stamp(`sent ${pi.sent.length}: ${pi.sent.map((s) => s.message.content.slice(0, 40)).join(" | ")}`);
  await pi.shutdown("quit", ctx);
  appendFileSync(process.env.ARM_OUT ?? "/dev/stderr", `--- ${delayKind}\n${events.join("\n")}\n`);
  expect(consumer).toBeDefined();
});
