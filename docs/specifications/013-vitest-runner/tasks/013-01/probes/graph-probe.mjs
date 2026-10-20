// 013-01 probe: after one warm run, which test files does each path's module graph reach?
import { createRequire } from "node:module";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const req = createRequire(`${root}/package.json`);
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const config = process.env.PROBE_CONFIG;
const vitest = await createVitest("test", { root, watch: false, reporters: ["dot"], fsModuleCache: false, ...(config ? { config } : {}) });
await vitest.standalone?.();
const specs = await vitest.globTestSpecifications();
await vitest.runTestSpecifications(specs);
const failed = vitest.state.getFiles().filter((f) => f.result?.state !== "pass").map((f) => `${f.name}:${f.result?.state}`);
console.log(JSON.stringify({ vitest: vitest.version, files: specs.length, failed }));
const rel = (f) => relative(root, f);
const sourceOf = (id) => {
  const f = id.replace(/^\0/, "").replace(/[?#].*$/s, "");
  return f.startsWith(`${root}/`) && !f.includes("/node_modules/") ? f : null;
};
const tests = new Set(specs.map((s) => s.moduleId));
const probes = process.argv.slice(3);
for (const p of probes) {
  const abs = `${root}/${p}`;
  const envs = {};
  for (const project of vitest.projects) {
    for (const [name, env] of Object.entries(project.vite.environments)) {
      const g = env.moduleGraph;
      const byFile = [...(g.getModulesByFile(abs) ?? [])];
      const byId = [...g.idToModuleMap.entries()].filter(([id]) => sourceOf(id) === abs).map(([, m]) => m);
      if (byFile.length === 0 && byId.length === 0) continue;
      const walk = (start) => {
        const seen = new Set();
        const hit = new Set();
        const queue = [...start];
        for (let n = queue.pop(); n !== undefined; n = queue.pop()) {
          if (seen.has(n)) continue;
          seen.add(n);
          if (tests.has(n.file)) hit.add(rel(n.file));
          queue.push(...n.importers);
        }
        return [...hit].sort();
      };
      const show = (id) => (id ?? "").replace(root, "<root>").replace("\0", "\\0");
      envs[`${project.name || "root"}/${name}`] = {
        modules: [...new Set([...byFile, ...byId])].map((m) => ({
          id: show(m.id ?? m.url),
          transformed: m.transformResult != null,
          inFileIndex: byFile.includes(m),
          importers: [...m.importers].map((i) => show(i.id ?? i.url)),
        })),
        testsReachedFromFileIndex: walk(byFile),
        testsReachedFromEveryModuleNamingIt: walk(new Set([...byFile, ...byId])),
      };
    }
  }
  console.log(JSON.stringify({ path: p, envs }));
}
await vitest.close();
