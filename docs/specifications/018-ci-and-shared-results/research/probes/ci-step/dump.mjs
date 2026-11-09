// throwaway: print each project's resolved serializedConfig and the root config's CI-relevant fields
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const { createVitest } = await import(pathToFileURL(dir + "/node_modules/vitest/dist/node.js").href);
const squeal = process.argv[3] === "squeal"; const extra = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const vitest = await createVitest("test", squeal ? { root: dir, watch: false, update: "none", includeTaskLocation: true, reporters: [{}], fsModuleCache: false, coverage: { enabled: false }, ...extra } : { watch: false, root: dir, ...extra }, {}, {});
const out = { root: { reporters: vitest.config.reporters.map((r) => (Array.isArray(r) ? r[0] : typeof r === "string" ? r : r.constructor?.name)), watch: vitest.config.watch, open: vitest.config.open, ui: vitest.config.ui }, projects: {} };
for (const p of vitest.projects) {
  const c = p.serializedConfig;
  out.projects[p.name] = JSON.parse(JSON.stringify(c, (k, v) => (v instanceof RegExp ? String(v) : v)));
}
console.log(JSON.stringify(out));
await vitest.close();
process.exit(0);
