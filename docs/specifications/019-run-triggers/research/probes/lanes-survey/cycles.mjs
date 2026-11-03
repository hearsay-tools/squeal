// Throwaway (row 019-08): heap after repeated create, run, close of one Vitest instance,
// as the slow lane does each time SlowRelease closes it (row 011-211).
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, cyclesArg = "6", workersArg = "2", filter = "", limitArg = "0"] = process.argv.slice(2);
const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);
const mb = (bytes) => Math.round(bytes / 1048576);
const self = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return { rss: mb(m.rss), heap: mb(m.heapUsed) };
};
console.log(JSON.stringify({ step: "baseline", ...self() }));
for (let i = 1; i <= Number(cyclesArg); i += 1) {
  const t = performance.now();
  let vitest = await createVitest("test", { root, watch: false, reporters: [], fsModuleCache: false, maxWorkers: Number(workersArg) });
  await vitest.standalone();
  const all = await vitest.globTestSpecifications(filter === "" ? undefined : [filter]);
  const limit = Number(limitArg);
  await vitest.runTestSpecifications(limit > 0 ? all.slice(0, limit) : all);
  await vitest.close();
  vitest = null;
  await new Promise((r) => setTimeout(r, 300));
  console.log(JSON.stringify({ step: `cycle ${i}`, ms: Math.round(performance.now() - t), ...self(), listeners: Object.fromEntries(process.eventNames().map((e) => [String(e), process.listenerCount(e)])) }));
}
