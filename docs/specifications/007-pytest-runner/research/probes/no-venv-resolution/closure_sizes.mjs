import fs from "node:fs";
import path from "node:path";
const [root, f] = process.argv.slice(2);
const G = JSON.parse(fs.readFileSync(f, "utf8")).files;
const out = [];
for (const t of Object.keys(G).filter((x) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(x))) {
  const todo = [t]; const parts = t.split("/").slice(0, -1);
  for (let i = 0; i <= parts.length; i++) { const c = [...parts.slice(0, i), "conftest.py"].join("/"); if (G[c]) todo.push(c); }
  const seen = new Set();
  while (todo.length) { const x = todo.pop(); if (seen.has(x)) continue; seen.add(x); todo.push(...(G[x]?.edges ?? [])); }
  out.push({ files: seen.size, cands: new Set([...seen].flatMap((x) => G[x]?.candidates ?? [])).size });
}
console.log(JSON.stringify(out));
