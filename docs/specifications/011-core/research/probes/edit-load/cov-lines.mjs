// 011-143 probe (throwaway): turn the per-test-file V8 block coverage that cov-setup.ts
// wrote into executed source lines, through each transformed script's inline source map.
// Usage: node cov-lines.mjs <coverage dir> <repo root> <out.jsonl> <trace-mapping module path>
// Out: one line per test file run: {"testPath", "lines": {"<repo path>": [executed line, ...]}}
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [, , dir, root, out, tmPath] = process.argv;
const { TraceMap, eachMapping } = createRequire(import.meta.url)(tmPath);
const perScript = new Map(); // source hash -> { offsets: Int32Array, lines: [ [path, line] ] } sorted by offset
function prepare(hash) {
  if (perScript.has(hash)) return perScript.get(hash);
  const code = readFileSync(`${dir}/src/${hash}.js`, "utf8");
  const m = code.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/);
  let entry = null;
  if (m) {
    const map = new TraceMap(JSON.parse(Buffer.from(m[1], "base64").toString("utf8")));
    const lineStart = [0];
    for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStart.push(i + 1);
    const pts = [];
    eachMapping(map, (mp) => {
      if (mp.source == null || mp.originalLine == null) return;
      pts.push([lineStart[mp.generatedLine - 1] + mp.generatedColumn, mp.source, mp.originalLine]);
    });
    pts.sort((a, b) => a[0] - b[0]);
    entry = pts;
  }
  perScript.set(hash, entry);
  return entry;
}
const rel = (p) => p.replace(/^file:\/\//, "").replace(root + "/", "").replace(/\?.*$/, "");
const lines = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".json")) continue;
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const res = {};
  for (const [url, { src, functions }] of Object.entries(j.files)) {
    const pts = prepare(src);
    const path = rel(url);
    if (!pts) continue;
    const ranges = functions.flat().map((r) => [r.startOffset, r.endOffset, r.count]);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    // V8 block ranges nest: the innermost range holding an offset gives its count
    const stack = []; let ri = 0; const hit = new Set();
    for (const [off, , line] of pts) {
      while (ri < ranges.length && ranges[ri][0] <= off) {
        while (stack.length && stack.at(-1)[1] <= ranges[ri][0]) stack.pop();
        stack.push(ranges[ri++]);
      }
      while (stack.length && stack.at(-1)[1] <= off) stack.pop();
      if (stack.length && stack.at(-1)[2] > 0) hit.add(line);
    }
    if (hit.size) res[path] = [...hit].sort((a, b) => a - b);
  }
  lines.push(JSON.stringify({ testPath: j.testPath, file: f, lines: res }));
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(JSON.stringify({ testRuns: lines.length, scripts: perScript.size }));
