// Throwaway: replays the last N commits' modified JS/TS files through the normalizer and two
// oracles (esbuild, and rolldown's oxc transform that Vite 8 runs for Vitest 5).
// Usage: SQUEAL_PARSER=1 node --import tsx history.mjs [N]
import { execFileSync } from "node:child_process";
import { extname, join } from "node:path";
import { transformSync as esbuild } from "esbuild";
import { createRequire } from "node:module";
import { catFileBatch } from "./blobs.mjs";
import { normalize } from "./strip.mjs";
import { REPO } from "./ts.mjs";

const require = createRequire(REPO + "node_modules/.pnpm/vite@8.3.2_@types+node@22.20.5_esbuild@0.28.2_jiti@2.7.0_tsx@4.23.15_yaml@2.9.0/node_modules/vite/package.json");
const { transformSync: oxc } = await import(require.resolve("rolldown/utils"));
const N = Number(process.argv[2] ?? 200);
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
const commits = git(["log", `-${N}`, "--no-merges", "--format=%H", "HEAD"]).trim().split("\n");
const EXT = /^(src|test)\/.*\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/; // plugin bundles under plugins/*/dist are left out
const pairs = [];
const perCommit = [];
for (const c of commits) {
  const lines = git(["diff-tree", "-r", "--no-commit-id", "--no-renames", c]).trim().split("\n").filter(Boolean);
  const mine = { c, all: lines.length, js: 0, jsModified: [] };
  for (const l of lines) {
    const [meta, path] = l.split("\t");
    const [, , oldOid, newOid, status] = meta.split(" ");
    if (!EXT.test(path)) continue;
    mine.js++;
    if (status === "M") {
      const p = { c, path, oldOid, newOid };
      pairs.push(p);
      mine.jsModified.push(p);
    }
  }
  perCommit.push(mine);
}
const oids = [...new Set(pairs.flatMap((p) => [p.oldOid, p.newOid]))];
const blobs = await catFileBatch(REPO, oids);
const LOADER = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx" };
const viaEsbuild = (t, ext) => { try { return esbuild(t, { loader: LOADER[ext], legalComments: "none" }).code; } catch { return null; } };
const viaOxc = (t, ext, path) => { try { const r = oxc(join(REPO, path), t, { sourcemap: false }); return r.errors?.length ? null : r.code; } catch { return null; } };
const tally = { pairs: pairs.length, fallback: 0, exact: 0, trim: 0, norm: 0, esbuild: 0, oxc: 0, falseEqTrim: [], falseEqNorm: [], reasons: {} };
let done = 0;
for (const p of pairs) {
  if (++done % 200 === 0) process.stderr.write(`${done}/${pairs.length}\n`);
  const ext = extname(p.path);
  const a = blobs.get(p.oldOid).toString("utf8");
  const b = blobs.get(p.newOid).toString("utf8");
  const ra = await normalize(a, ext);
  const rb = await normalize(b, ext);
  const ea = viaEsbuild(a, ext), eb = viaEsbuild(b, ext);
  const oa = viaOxc(a, ext, p.path), ob = viaOxc(b, ext, p.path);
  p.esbuild = ea !== null && ea === eb;
  p.oxc = oa !== null && oa === ob;
  if (p.esbuild) tally.esbuild++;
  if (p.oxc) tally.oxc++;
  if (!ra.ok || !rb.ok) {
    tally.fallback++;
    const r = !ra.ok ? ra.reason : rb.reason;
    tally.reasons[r] = (tally.reasons[r] ?? 0) + 1;
    p.exact = p.trim = p.norm = false;
    continue;
  }
  p.exact = ra.exact === rb.exact;
  p.trim = ra.trim === rb.trim;
  p.norm = ra.norm === rb.norm;
  for (const k of ["exact", "trim", "norm"]) if (p[k]) tally[k]++;
  if (p.trim && !(p.esbuild && p.oxc)) tally.falseEqTrim.push(`${p.c.slice(0, 9)} ${p.path} esbuild=${p.esbuild} oxc=${p.oxc}`);
  if (p.norm && !(p.esbuild && p.oxc)) tally.falseEqNorm.push(`${p.c.slice(0, 9)} ${p.path} esbuild=${p.esbuild} oxc=${p.oxc}`);
}
const commitsTouchingJs = perCommit.filter((m) => m.js > 0);
const skippable = (k) => commitsTouchingJs.filter((m) => m.js === m.jsModified.length && m.jsModified.every((p) => p[k])).length;
const partial = (k) => commitsTouchingJs.filter((m) => m.jsModified.some((p) => p[k])).length;
console.log(JSON.stringify({
  commits: commits.length, first: commits.at(-1).slice(0, 9), last: commits[0].slice(0, 9),
  commitsTouchingJs: commitsTouchingJs.length,
  commitAllJsEqual: { exact: skippable("exact"), trim: skippable("trim"), norm: skippable("norm"), esbuild: skippable("esbuild"), oxc: skippable("oxc") },
  commitSomeJsEqual: { exact: partial("exact"), trim: partial("trim"), norm: partial("norm"), oxc: partial("oxc") },
  ...tally,
}, null, 1));
if (process.env.LIST) for (const p of pairs.filter((p) => p.norm || p.trim || p.oxc)) console.log(`${p.c.slice(0, 9)} ${p.path} exact=${p.exact} trim=${p.trim} norm=${p.norm} esbuild=${p.esbuild} oxc=${p.oxc}`);
