// THROWAWAY probe. Which resolvers report the paths they probed (D3 resolution candidates)?
import erPkg from "enhanced-resolve";
import { realpathSync } from "node:fs";
import { join } from "node:path";
const { CachedInputFileSystem, ResolverFactory } = erPkg;
const pkg = realpathSync("fixtures/ref/packages/core");
const r = ResolverFactory.createResolver({ fileSystem: new CachedInputFileSystem(await import("node:fs"), 4000), useSyncFileSystemCalls: true,
  extensions: [".ts", ".tsx", ".js", ".json"], extensionAlias: { ".js": [".ts", ".tsx", ".js"] }, conditionNames: ["node", "import"],
  tsconfig: { configFile: join(pkg, "tsconfig.json") } });
for (const [from, spec] of [["src/edge", "./extless-target.js"], ["src/edge", "./paths-target"], ["src/edge", "~/edge/dir"], ["src/edge", "@ref/util/str"], ["src/edge", "./missing"]]) {
  const ctx = { fileDependencies: new Set(), missingDependencies: new Set(), contextDependencies: new Set() };
  let res; try { res = r.resolveSync({}, join(pkg, from), spec, ctx); } catch (e) { res = "ERR " + e.message.split("\n")[0]; }
  const short = (s) => [...s].map((p) => p.replace(pkg, "core").replace(/.*fixtures\/ref\//, ""));
  console.log(spec, "->", String(res).replace(/.*fixtures\/ref\//, ""), "\n  missing:", short(ctx.missingDependencies).slice(0, 12), ctx.missingDependencies.size, "\n  files:", short(ctx.fileDependencies).slice(0, 6));
}
