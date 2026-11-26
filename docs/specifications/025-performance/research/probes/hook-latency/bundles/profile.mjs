// Throwaway probe (row 025-14). Splits `node --cpu-prof` profiles of hook runs
// (one directory per case) into: Node outside the bundle (start, builtin and
// module loading, compiling the bundle), the bundle's top-level evaluation (a
// stack through the module function and not through runMain), and the hook's
// work (every other stack with a bundle frame). Top-level and hook self time is
// attributed to source files by the bundle's `// src/...` comments (line ticks).
// Usage: node profile.mjs <profRoot> <distDir> [top]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [root, dist, topN = "12"] = process.argv.slice(2);
const sectionCache = new Map();
function lineSections(url) {
  if (!sectionCache.has(url)) {
    const lines = readFileSync(fileURLToPath(url), "utf8").split("\n");
    let cur = "(banner)";
    sectionCache.set(url, lines.map((l) => {
      const m = /^\/\/ ((?:src|node_modules)\/\S+)$/.exec(l);
      if (m) cur = m[1];
      return cur;
    }));
  }
  return sectionCache.get(url);
}
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
const fmt = (m, runs, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([k, v]) => `${(v / runs / 1000).toFixed(2)} ${k}`).join("; ");

for (const kase of readdirSync(root).sort()) {
  const files = readdirSync(join(root, kase));
  const cat = new Map(), topFiles = new Map(), hookFiles = new Map(), hookFns = new Map(), nodeFns = new Map();
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(root, kase, f), "utf8"));
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const dt = new Map();
    p.samples.forEach((id, i) => add(dt, id, p.timeDeltas[i] ?? 0));
    for (const [id, us] of dt) {
      const n = byId.get(id);
      const stack = [];
      for (let x = id; x !== undefined; x = parent.get(x)) stack.push(byId.get(x).callFrame);
      const inBundle = (cf) => cf.url.startsWith(`file://${dist}`);
      const top = stack.some((cf) => inBundle(cf) && cf.functionName === "" && cf.lineNumber === 0);
      const main = stack.some((cf) => inBundle(cf) && cf.functionName === "runMain");
      const any = stack.some(inBundle);
      const name = n.callFrame.functionName;
      let c;
      if (name === "(garbage collector)" || name === "(program)" || name === "(idle)" || name === "(root)") c = name;
      else if (!any) c = "node outside the bundle";
      else if (top && !main) c = "top-level evaluation";
      else c = "hook work";
      add(cat, c, us);
      const own = n.callFrame;
      const where = inBundle(own) ? lineSections(own.url)[own.lineNumber] : `${own.url.replace(/^node:internal\//, "")}`;
      if (c === "top-level evaluation") {
        if (inBundle(own) && n.positionTicks) {
          const lines = lineSections(own.url);
          const ticks = n.positionTicks.reduce((s, t) => s + t.ticks, 0);
          for (const t of n.positionTicks) add(topFiles, lines[t.line - 1], (us * t.ticks) / ticks);
        } else add(topFiles, `${own.functionName || "(anon)"} ${where}`, us);
      }
      if (c === "hook work") {
        add(hookFiles, inBundle(own) ? where : `node: ${own.functionName || "(anon)"} ${where}`, us);
        add(hookFns, `${own.functionName || "(anon)"} ${inBundle(own) ? where : own.url}`, us);
      }
      if (c === "node outside the bundle") add(nodeFns, `${own.functionName || "(anon)"} ${own.url}`, us);
    }
  }
  const runs = files.length;
  console.log(`\n## ${kase} (${runs} profiles, ms per run)`);
  console.log(`  phases: ${fmt(cat, runs, 9)}`);
  console.log(`  top-level by source: ${fmt(topFiles, runs, Number(topN))}`);
  console.log(`  hook work by source: ${fmt(hookFiles, runs, Number(topN))}`);
  console.log(`  node outside the bundle by function: ${fmt(nodeFns, runs, 8)}`);
}
