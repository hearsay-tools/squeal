/*
 * Throwaway probe, row 011-438 (wave 132). Pi's delivery host (src/harness/pi/host.ts) with a worker
 * that answers at once. Pi's main thread is then held for `holdMs` right after the call is posted,
 * with Atomics.wait (a sleep: no CPU load), as a starved or paused main thread on a loaded machine
 * would be. Does the call resolve with the worker's answer, or `null` at the 2,000 ms deadline
 * (EVENT_DEADLINE_MS), the answer having been there in time? And is the next call a fresh worker?
 * Writes output.txt; asserts nothing.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, it } from "vitest";
import { EVENT_DEADLINE_MS } from "../../../../../../../src/harness/pi/extension.js";
import { createDeliveryHost } from "../../../../../../../src/harness/pi/host.js";

const rows: string[] = [];
afterAll(() => writeFileSync(join(import.meta.dirname, "output.txt"), `${rows.join("\n")}\n`));

let starts = 0;
const ECHO = () => {
  starts++;
  return new Worker(
    `const { parentPort } = require("node:worker_threads");
     parentPort.on("message", ({ id, request }) => parentPort.postMessage({ id, ok: true, answer: "blocked: " + request.kind, at: Date.now() }));`,
    { eval: true },
  );
};
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

it("a main-thread stall around the deadline", async () => {
  rows.push(`EVENT_DEADLINE_MS = ${EVENT_DEADLINE_MS}`);
  for (const holdMs of [0, 1_500, 1_990, 2_100, 3_000]) {
    starts = 0;
    const host = createDeliveryHost(ECHO);
    await host.call({ kind: "ping" } as never, EVENT_DEADLINE_MS); // warm: the worker is up
    const started = performance.now();
    const answer = host.call({ kind: "toolCall" } as never, EVENT_DEADLINE_MS);
    if (holdMs > 0) sleep(holdMs);
    const got = await answer;
    const ms = Math.round(performance.now() - started);
    const next = await host.call({ kind: "ping" } as never, EVENT_DEADLINE_MS);
    rows.push(`main thread held ${holdMs} ms | answer ${JSON.stringify(got)} after ${ms} ms | workers started ${starts} (2 = the next call started a fresh one) | next call ${JSON.stringify(next)}`);
    host.stop();
  }
}, 60_000);
