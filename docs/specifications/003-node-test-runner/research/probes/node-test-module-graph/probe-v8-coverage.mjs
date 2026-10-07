// THROWAWAY probe. NODE_V8_COVERAGE as an observed graph: which project files each test process's
// coverage file lists, against observe.mjs output.  usage: node probe-v8-coverage.mjs <fixture> <observed.json>
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const [root, obsFile] = process.argv.slice(2);
const realRoot = realpathSync(root), pkg = join(realRoot, "packages/core");
const files = readdirSync(join(pkg, "test/unit")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/unit/${f}`);
const dir = `/tmp/ntmg-v8cov-${process.pid}`; rmSync(dir, { recursive: true, force: true });
const t0 = performance.now();
try { execFileSync(process.execPath, ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx", "--test", "--test-reporter=dot", ...files], { cwd: pkg, env: { ...process.env, NODE_V8_COVERAGE: dir }, stdio: "pipe" }); } catch (e) { console.error("exit", e.status); }
const wall = performance.now() - t0;
const obs = JSON.parse(readFileSync(obsFile, "utf8"));
const covFiles = readdirSync(dir);
let missing = new Map(), extra = new Map(), matched = 0, sizes = [];
for (const f of covFiles) {
  const urls = JSON.parse(readFileSync(join(dir, f), "utf8")).result.map((s) => s.url).filter((u) => u.startsWith("file:") || u.startsWith("/"));
  const proj = [...new Set(urls.map((u) => (u.startsWith("file:") ? fileURLToPath(u.split("?")[0]) : u)).filter((p) => p.startsWith(realRoot + "/") && !p.includes("/node_modules/")).map((p) => relative(realRoot, p)))];
  const test = proj.find((p) => p.endsWith(".test.ts"));
  if (!test) { console.log("coverage file without a test file:", f, proj.length, "project files", proj.slice(0, 3)); continue; }
  matched++; sizes.push(proj.length);
  const ob = new Set(obs[test]);
  for (const p of ob) if (!proj.includes(p)) missing.set(p, (missing.get(p) ?? 0) + 1);
  for (const p of proj) if (!ob.has(p)) extra.set(p, (extra.get(p) ?? 0) + 1);
}
console.log(JSON.stringify({ node: process.version, coverageFiles: covFiles.length, matchedToTestFile: matched, wallMs: Math.round(wall) }));
console.log("in observed, not in V8 coverage:", [...missing.entries()].slice(0, 8));
console.log("in V8 coverage, not in observed:", [...extra.entries()].slice(0, 8));
