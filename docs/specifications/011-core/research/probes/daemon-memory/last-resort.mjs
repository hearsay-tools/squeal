// Throwaway probe for research 011-53. Runs only inside the /tmp scratch, with its environment.
//   node --expose-gc last-resort.mjs <root> <test-file>
// One Vitest instance with the adapter's options at 4 workers, the keying walk over every
// listed file, and one run of <test-file>. Then, open: a regular full GC, then a last-resort
// GC (gc({flavor:"last-resort"}), which V8 runs as CollectAllAvailableGarbage); then close()
// and a last-resort GC again. Private memory, the smaps split and the pause at each step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, testRel] = process.argv.slice(2);
const mib = (n) => Math.round(n / 2 ** 20);
const split = () => {
  const o = { heap256: 0, mimalloc: 0, glibc: 0, anonOther: 0 };
  let cur = null;
  for (const line of readFileSync("/proc/self/smaps", "utf8").split("\n")) {
    const m = /^([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)$/.exec(line);
    if (m) {
      const size = parseInt(m[2], 16) - parseInt(m[1], 16);
      const name = m[4].trim();
      cur = m[3] !== "0" && name.startsWith("/") ? null : name === "[anon:mimalloc]" ? "mimalloc" : name === "[heap]" ? "glibc" : name === "" && size === 262144 ? "heap256" : "anonOther";
    } else if (cur && line.startsWith("Rss:")) o[cur] += Number(line.split(/\s+/)[1]);
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / 1024)]));
};
const priv = () => {
  const s = readFileSync("/proc/self/status", "utf8");
  return Math.round((Number(/RssAnon:\s+(\d+)/.exec(s)[1]) + Number(/RssShmem:\s+(\d+)/.exec(s)[1])) / 1024);
};
const step = (label, flavor) => {
  let pauseMs = null;
  if (flavor) {
    const t = performance.now();
    globalThis.gc({ type: "major", execution: "sync", flavor });
    pauseMs = Math.round(performance.now() - t);
  }
  const m = process.memoryUsage();
  console.log(JSON.stringify({ label, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], pauseMs, privMiB: priv(), heapUsedMiB: mib(m.heapUsed), heapTotalMiB: mib(m.heapTotal), ...split() }));
};

const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);
process.chdir(root);
step("bare", "last-resort");
const vitest = await createVitest("test", { root, watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, maxWorkers: 4 });
await vitest.standalone();
const specs = (await vitest.globTestSpecifications()).filter((s) => !s.moduleId.includes("/packages/web/e2e/"));
for (const s of specs) {
  const env = s.project.vite.environments.ssr;
  const seen = new Set();
  const visit = async (f) => {
    if (seen.has(f) || f.includes("node_modules")) return;
    seen.add(f);
    try { if (!env.moduleGraph.getModuleById(f)?.transformResult) await env.transformRequest(f); } catch { return; }
    await Promise.all([...(env.moduleGraph.getModuleById(f)?.importedModules ?? [])].map((m) => m.file).filter(Boolean).map(visit));
  };
  await visit(s.moduleId);
}
const target = specs.filter((s) => s.moduleId === join(root, testRel));
await vitest.runTestSpecifications(target);
step("walked+run");
step("regular-gc", "regular");
step("last-resort-gc", "last-resort");
await new Promise((r) => setTimeout(r, 5000));
step("last-resort+5s");
await vitest.close();
step("closed+last-resort", "last-resort");
process.exit(0);
