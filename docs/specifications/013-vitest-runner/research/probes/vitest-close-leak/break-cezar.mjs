// Throwaway probe for research 013-05: the break candidate on a cezar-size instance.
//   node --expose-gc break-cezar.mjs <cezar-root> <cycles> <files-walked> [break|break-noplugins|plain] [snapshot-out]
// Each cycle: createVitest with the adapter's options, standalone, transform the import closures
// of the first <files-walked> test files (as Squeal's keying walk does), close, then (with
// "break") break.mjs. After two GCs in separate macrotasks: instances alive (WeakRef), heapUsed,
// private memory (RssAnon), load. At the end, one last-resort GC (011-53) and the same figures.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";

const [root, cyclesArg, walkArg, mode, snapOut] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const { breakRetainer } = await import("./break.mjs");
const cut = mode === "break" ? (v) => breakRetainer(v) : mode === "break-noplugins" ? (v) => breakRetainer(v, { plugins: false }) : null;
process.chdir(root);
const tick = () => new Promise((r) => setTimeout(r, 0));
const gc = async () => { for (let i = 0; i < 2; i++) { await tick(); globalThis.gc(); } await tick(); };
const priv = () => Math.round(Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))[1]) / 1024);
const heap = () => Math.round(process.memoryUsage().heapUsed / 2 ** 20);
const refs = [];
for (let cycle = 1; cycle <= Number(cyclesArg); cycle++) {
  let vitest = await createVitest("test", {
    root, watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, maxWorkers: 4,
  });
  await vitest.standalone();
  let specs = (await vitest.globTestSpecifications()).filter((s) => !s.moduleId.includes("/e2e/"));
  let visits = 0;
  for (const s of specs.slice(0, Number(walkArg))) {
    const env = s.project.vite.environments.ssr;
    const seen = new Set();
    const visit = async (f) => {
      if (seen.has(f) || f.includes("node_modules")) return;
      seen.add(f); visits++;
      try { await env.transformRequest(f); } catch { return; }
      await Promise.all([...(env.moduleGraph.getModuleById(f)?.importedModules ?? [])].map((m) => m.file).filter(Boolean).map(visit));
    };
    await visit(s.moduleId);
  }
  specs = null;
  await gc();
  const open = { heapUsedMiB: heap(), privMiB: priv() };
  refs.push(new WeakRef(vitest));
  await vitest.close();
  const emptied = cut ? cut(vitest) : 0;
  vitest = null;
  await gc();
  const alive = refs.filter((r) => r.deref() !== undefined).length;
  await gc();
  console.log(JSON.stringify({ mode: mode ?? "plain", cycle, visits, emptied, alive, open, closed: { heapUsedMiB: heap(), privMiB: priv() }, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0] }));
}
await tick();
globalThis.gc({ type: "major", execution: "sync", flavor: "last-resort" });
await new Promise((r) => setTimeout(r, 2000));
console.log(JSON.stringify({ mode: mode ?? "plain", after: "last-resort GC", heapUsedMiB: heap(), privMiB: priv(), load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0] }));
if (snapOut) console.log(v8.writeHeapSnapshot(snapOut));
process.exit(0);
