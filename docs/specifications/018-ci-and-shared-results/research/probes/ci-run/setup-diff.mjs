import { execFileSync } from "node:child_process";
const repo = process.argv[2];
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const blobs = (sha) => new Map(git("ls-tree", "-r", sha).split("\n").filter(Boolean).map((l) => { const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l); return m ? [m[2], m[1]] : null; }).filter(Boolean));
function walk(sha) { const t = blobs(sha); const seen = new Set(); const todo = ["test/global-teardown.ts"];
  while (todo.length) { const p = todo.pop(); if (seen.has(p) || !t.has(p)) continue; seen.add(p); const dir = p.split("/").slice(0, -1).join("/");
    for (const m of git("cat-file", "-p", t.get(p)).matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) { const out = []; for (const s of `${dir}/${m[1]}`.replace(/\.js$/, ".ts").split("/")) { if (s === "..") out.pop(); else if (s !== ".") out.push(s); } todo.push(out.join("/")); } }
  return [seen, t]; }
for (const [a, b] of [["02b4b92f5","768ff4a49"],["3140f7c01","d3535c720"],["d3535c720","2e62ee7c3"],["1a0af263a","e59ed2260"]]) {
  const [s, tb] = walk(b); const ta = blobs(a); console.log(a, b, "setup closure", s.size, "changed:", [...s].filter((p) => ta.get(p) !== tb.get(p)).join(" "));
}
