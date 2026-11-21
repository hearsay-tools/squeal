// usage: node classify.cjs <label dir> — per test file: did Squeal's recorder record
// <root>/package.json, and which readers (process kind + caller) the tracer saw.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const secs = new Map(
  fs.readFileSync(path.join(__dirname, "files.tsv"), "utf8").trim().split("\n").map((l) => {
    const [p, s] = l.split("\t");
    return [p, Number(s)];
  }),
);
const done = fs.readFileSync(path.join(dir, "done.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const traces = fs.existsSync(path.join(dir, "trace.ndjson"))
  ? fs.readFileSync(path.join(dir, "trace.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  : [];

function reader(t) {
  const a = t.argv.join(" ");
  if (a.includes("vitest.mjs")) return null; // Vitest's main process: not a test's read
  const proc = a.includes("vitest/dist/workers") ? "worker" : "child";
  const s = t.stack.join("\n");
  let who = "other";
  if (s.includes("daemon/version.ts") || s.includes("daemon/version.js")) who = "squealVersion";
  else if (/harness\/build\.(ts|js)/.test(s)) who = /nodeFloor/.test(s) ? "build.ts nodeFloor" : "build.ts rootVersion";
  else if (s.includes("opencode/host")) who = "opencode manifestFloor";
  else if (s.includes("test/daemon/helpers")) who = "buildCli copy";
  else {
    const m = /\(?(?:file:\/\/)?\S*\/tree\/(test\/[^:)]+)/.exec(s);
    if (m) who = `test read ${m[1]}`;
    else {
      const m2 = /\/tree\/(src\/[^:)]+)/.exec(s);
      if (m2) who = `src ${m2[1]}`;
      else if (s.includes("node_modules/")) who = `dependency ${/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?([^/]+)/.exec(s)?.[1]}`;
    }
  }
  return `${proc}: ${who}`;
}

const out = [];
for (const d of done) {
  const f = d.done;
  const obsDir = path.join(dir, "obs", f.replaceAll("/", "_"));
  let recorded = false;
  for (const n of fs.existsSync(obsDir) ? fs.readdirSync(obsDir) : []) {
    for (const l of fs.readFileSync(path.join(obsDir, n), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const o = JSON.parse(l);
      for (const k of ["f", "l", "r", "w", "d", "m"])
        for (const p of o[k] || []) if (p.endsWith("/tree/package.json")) recorded = true;
    }
  }
  const kinds = new Set(traces.filter((t) => t.test === f).map(reader).filter(Boolean));
  out.push({ f, exit: d.exit, s: secs.get(f), recorded, kinds: [...kinds].sort() });
}
if (process.argv[3] === "--json") console.log(JSON.stringify(out));
else for (const o of out) console.log(`${o.recorded ? "R" : "-"} ${o.exit} ${(o.s ?? 0).toFixed(1).padStart(6)} ${o.f}  ${o.kinds.join("; ")}`);
