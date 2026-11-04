// Row 019-19: make, run and close a Vitest adapter N times in one process, then count what stays.
// Usage, from the repository root (tsx loads the TypeScript sources):
//   node --expose-gc --import tsx adapter-probe.mjs <fixture root> <cycles> [<out.heapsnapshot>]
// The fixture must resolve `vitest` (a copy under test/fixtures/vitest/.tmp does). Prints one JSON
// line: adapters still reachable after the last close and three full GCs, and heap used.
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { writeHeapSnapshot } from "node:v8";

const [root, cyclesText = "5", snapshot] = process.argv.slice(2);
const cycles = Number(cyclesText);
const { createVitestAdapter } = await import(
  pathToFileURL(resolve("src/runners/vitest/index.ts")).href
);

async function cycle() {
  const adapter = await createVitestAdapter({ root });
  const report = await adapter.run([{ project: "", path: "test/math.test.ts" }], {
    runId: randomUUID(),
    logDir: join(root, ".squeal-logs"),
    timeoutMs: null,
  });
  if (report.results.length === 0) throw new Error("the run reported no result");
  await adapter.close();
  return new WeakRef(adapter);
}

const collect = async () => {
  for (let i = 0; i < 3; i++) {
    await sleep(20);
    globalThis.gc();
  }
};

const refs = [];
await collect();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < cycles; i++) refs.push(await cycle());
await collect();
const heapUsed = process.memoryUsage().heapUsed;
// Before any `deref`, which keeps its target until the job ends.
if (snapshot) writeHeapSnapshot(snapshot);
const alive = refs.filter((ref) => ref.deref() !== undefined).length;
const mb = (bytes) => Number((bytes / 2 ** 20).toFixed(1));
console.log(JSON.stringify({ cycles, adaptersAlive: alive, heapBeforeMB: mb(before), heapAfterMB: mb(heapUsed) }));
