/*
 * The real idle GC, for `idle-gc-memory.test.ts` (row 011-69): allocates
 * about 300 MiB of small objects, drops them, runs a plain full GC, which
 * frees them but leaves V8 their pages, and then the daemon's idle GC with
 * its default `gc` lookup and memory reading. Then asks a worker thread
 * whether it sees a global `gc`. Run as `node --import tsx
 * idle-gc-child.ts`; prints one JSON line.
 */
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { exposeGc, IDLE_GC_AFTER_MS, IdleGc, readMemory } from "../../src/core/daemon/idle-gc.js";

const gc = exposeGc();
if (gc === null) throw new Error("no gc");
let clock = 0;
const lines: string[] = [];
const notes: string[] = [];
const idle = new IdleGc({
  now: () => clock,
  note: (text) => notes.push(text),
  log: (line) => lines.push(line),
});
idle.ready();

const start = readMemory();
let kept: { i: number; s: string }[] | null = [];
for (let i = 0; i < 4_000_000; i++) kept.push({ i, s: `x${i}` });
const allocated = readMemory();
kept = null;
// A regular full GC: what the idle GC must do better than.
(gc as (options: object) => void)({ type: "major", execution: "sync" });
const freed = readMemory();
clock += IDLE_GC_AFTER_MS;
idle.check();
const collected = readMemory();
const mib = (bytes: number) => Math.round(bytes / 2 ** 20);
const worker = new Worker(
  "require('node:worker_threads').parentPort.postMessage(typeof globalThis.gc)",
  { eval: true },
);
const [workerGc] = (await once(worker, "message")) as [string];
await worker.terminate();
console.log(
  JSON.stringify({
    kind: start.kind,
    start: mib(start.bytes),
    allocated: mib(allocated.bytes),
    freed: mib(freed.bytes),
    collected: mib(collected.bytes),
    lines,
    notes,
    globalGc: typeof (globalThis as { gc?: unknown }).gc,
    workerGc,
  }),
);
