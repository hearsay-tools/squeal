// Throwaway probe (001-102): what Squeal can observe of each installed package a test file depends on.
// Usage: node ../observe.mjs  (from fixture/). Prints, per test file, the static transform-graph deps
// (raw, as Vite records them) and the runtime importDurations Vitest reports.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { createVitest } = await import(pathToFileURL(createRequire(process.cwd() + "/package.json").resolve("vitest/node")).href);
const root = process.cwd();
const runtime = new Map();
const vitest = await createVitest("test", {
  watch: false,
  root,
  reporters: [{ onTestModuleEnd(m) { runtime.set(m.moduleId, m.diagnostic().importDurations); } }],
  experimental: { importDurations: { limit: 10000 } },
});
const project = vitest.projects[0];
const specs = await vitest.globTestSpecifications();
const env = project.vite.environments.ssr;
for (const spec of specs) {
  const seen = new Map();
  const visit = async (id) => {
    if (seen.has(id)) return;
    seen.set(id, null);
    let r;
    try { r = env.moduleGraph.getModuleById(id)?.transformResult ?? (await env.transformRequest(id)); } catch (e) { seen.set(id, "ERR " + e.message); return; }
    const deps = [...(r?.deps ?? []), ...(r?.dynamicDeps ?? [])];
    seen.set(id, deps);
    if (id.includes("/node_modules/")) return;
    for (const d of deps) if (d.startsWith("/@fs/")) await visit(d.slice(4)); else if (d.startsWith("/") && !d.startsWith("/@")) await visit(root + d);
  };
  await visit(spec.moduleId);
  console.log("##", spec.moduleId.slice(root.length));
  for (const [id, deps] of seen) console.log("  static", id.replace(root, ""), "->", JSON.stringify(deps)?.replaceAll(root, ""));
}
await vitest.start();
for (const [file, d] of runtime) {
  console.log("## runtime", file.slice(root.length));
  for (const [id, v] of Object.entries(d ?? {})) console.log("  ", id.replace(root, ""), v.external ? "external" : "inlined", "importer=" + (v.importer ?? "").replace(root, ""));
}
await vitest.close();
