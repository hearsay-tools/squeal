// Throwaway probe for research 011-53. Runs only inside the /tmp scratch, with its environment.
//   node --expose-gc leak-check.mjs <root> <cycles> <files-walked>
// Does a closed Vitest instance stay reachable? Each cycle: createVitest (adapter options),
// standalone, transform the import closures of the first <files-walked> test files, close,
// full GC. Then v8.queryObjects counts the live objects whose prototype chain holds the
// constructor of Vitest, TestProject and Vite's environment module graph and module node,
// as taken from the first instance.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";

const [root, cyclesArg, walkArg] = process.argv.slice(2);
const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);
process.chdir(root);
const priv = () => {
  const s = readFileSync("/proc/self/status", "utf8");
  return Math.round(Number(/RssAnon:\s+(\d+)/.exec(s)[1]) / 1024);
};
const ctors = {};
const count = () =>
  Object.fromEntries(Object.entries(ctors).map(([k, c]) => [k, v8.queryObjects(c, { format: "count" })]));
for (let cycle = 1; cycle <= Number(cyclesArg); cycle++) {
  let vitest = await createVitest("test", {
    root, watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, maxWorkers: 4,
  });
  await vitest.standalone();
  const specs = (await vitest.globTestSpecifications()).filter((s) => !s.moduleId.includes("/e2e/"));
  for (const s of specs.slice(0, Number(walkArg))) {
    const env = s.project.vite.environments.ssr;
    const seen = new Set();
    const visit = async (f) => {
      if (seen.has(f) || f.includes("node_modules")) return;
      seen.add(f);
      try { await env.transformRequest(f); } catch { return; }
      await Promise.all([...(env.moduleGraph.getModuleById(f)?.importedModules ?? [])].map((m) => m.file).filter(Boolean).map(visit));
    };
    await visit(s.moduleId);
  }
  if (cycle === 1) {
    const env = specs[0].project.vite.environments.ssr;
    ctors.Vitest = vitest.constructor;
    ctors.TestProject = specs[0].project.constructor;
    ctors.ModuleGraph = env.moduleGraph.constructor;
    ctors.ModuleNode = [...env.moduleGraph.idToModuleMap.values()][0].constructor;
  }
  const open = count();
  await vitest.close();
  vitest = null;
  globalThis.gc();
  globalThis.gc();
  console.log(JSON.stringify({ cycle, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], openCounts: open, closedCounts: count(), heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 2 ** 20), privMiB: priv() }));
}
process.exit(0);
