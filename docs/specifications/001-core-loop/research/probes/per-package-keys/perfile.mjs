// Throwaway probe (001-102): per test file, the installed packages its closure imports directly
// (first hop out of project files), as [importer location, package name] pairs, plus the
// environment-wide starts (setup files, globalSetup, config imports). Writes JSON to argv[2].
// Run from the worktree root. Mirrors Squeal's importClosure walk (src/runners/vitest/graph.ts).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
const req = createRequire(join(process.cwd(), "package.json"));
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const { init, parse } = await import(pathToFileURL(req.resolve("es-module-lexer")).href);
await init;
const root = process.cwd();
const rel = (p) => relative(root, p);

// Workspace locations, longest first: a project file is looked up from the one that contains it.
const lock = JSON.parse(readFileSync("node_modules/.package-lock.json", "utf8")).packages;
const workspaces = Object.keys(lock).filter((k) => !k.includes("node_modules/") && k !== "").sort((a, b) => b.length - a.length);
const fromOf = (file) => workspaces.find((w) => rel(file).startsWith(`${w}/`)) ?? "";
const nameOf = (spec) => spec.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[1];

const pkgFromPath = (file, path) => {
  // An installed path: the package is the last node_modules/<name> segment.
  const m = path.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return m ? [fromOf(file), m[1]] : null;
};

const t0 = performance.now();
const vitest = await createVitest("test", { watch: false });
const tCreate = performance.now() - t0;
const out = { root, projects: [] };
let walkMs = 0;
for (const project of vitest.projects) {
  const env = project.vite.environments.ssr;
  const pr = project.config.root;
  const firstHop = async (entries) => {
    const files = new Set(), hop = new Map(), builtins = new Set();
    const add = (pair) => pair && hop.set(pair.join("\0"), pair);
    const visit = async (file) => {
      if (files.has(file) || !existsSync(file)) return;
      files.add(file);
      let r;
      try { r = env.moduleGraph.getModuleById(file)?.transformResult ?? (await env.transformRequest(file)); } catch { return; }
      const next = [];
      for (const dep of [...(r?.deps ?? []), ...(r?.dynamicDeps ?? [])]) {
        if (dep.startsWith("node:")) { builtins.add(dep.slice(5).split("/")[0]); continue; }
        if (dep.startsWith("\0") || (dep.includes(":") && !dep.startsWith("/"))) continue;
        const path = dep.split("?")[0];
        let abs = null;
        if (path.startsWith("/@fs/")) abs = path.slice(4);
        else if (path.startsWith("/@")) continue;
        else if (path.startsWith("/")) abs = join(pr, path);
        else if (path.startsWith(".")) abs = resolvePath(dirname(file), path);
        else { add([fromOf(file), nameOf(path)]); continue; } // bare id Vite left as is
        if (abs.includes("/node_modules/")) add(pkgFromPath(file, abs));
        else next.push(abs);
      }
      await Promise.all(next.map(visit));
    };
    await Promise.all(entries.map(visit));
    return { hop: [...hop.values()], builtins: [...builtins].sort() };
  };
  // Environment-wide starts: setup and globalSetup closures, bare imports of the config files.
  const cfg = project.vite.config;
  const setup = [...(project.config.setupFiles ?? []), ...[project.config.globalSetup ?? []].flat()];
  const envStarts = (await firstHop(setup)).hop;
  for (const f of cfg.configFileDependencies ?? []) {
    const [imports] = parse(readFileSync(f, "utf8"));
    for (const i of imports) if (i.n && !i.n.startsWith(".") && !i.n.startsWith("node:") && !i.n.startsWith("/")) envStarts.push([fromOf(f), nameOf(i.n)]);
  }
  envStarts.push(["", "vitest"]);
  const specs = (await vitest.globTestSpecifications()).filter((s) => s.project === project);
  const files = {}, builtins = {};
  const w0 = performance.now();
  for (const s of specs) {
    const r = await firstHop([s.moduleId]);
    files[rel(s.moduleId)] = r.hop;
    builtins[rel(s.moduleId)] = r.builtins;
  }
  walkMs += performance.now() - w0;
  out.projects.push({ name: project.name, envStarts, files, builtins });
}
await vitest.close();
out.timing = { createMs: Math.round(tCreate), walkMs: Math.round(walkMs) };
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log("projects", out.projects.length, "files", out.projects.reduce((n, p) => n + Object.keys(p.files).length, 0), out.timing);
