// Throwaway probe (row 025-14). Reads NODE_V8_COVERAGE output of hook runs
// (one directory per case) and the bundle each ran, and splits the bundle's
// source files into those with a function that ran and those of which only
// top-level code ran (declarations, constants, tables). Cases of one hook are
// united: a file counts as called when any case called it.
// Usage: node coverage.mjs <covRoot> <distDir> [--files] [--json <called.json>]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupOf } from "./sections.mjs";

const [root, dist] = process.argv.slice(2);
const listFiles = process.argv.includes("--files");

/** Section starts (char offsets) of a bundle: [offset, source path]. */
function sectionStarts(text) {
  const starts = [[0, "(banner)"]];
  const re = /^\/\/ ((?:src|node_modules|plugins)\/\S+)$/gm;
  for (let m; (m = re.exec(text)); ) starts.push([m.index, m[1]]);
  return starts;
}
function sectionAt(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid][0] <= offset) lo = mid; else hi = mid - 1;
  }
  return starts[lo][1];
}

const byHook = new Map(); // hook -> { text, starts, called:Set, size:Map }
for (const kase of readdirSync(root)) {
  for (const f of readdirSync(join(root, kase))) {
    const cov = JSON.parse(readFileSync(join(root, kase, f), "utf8"));
    for (const script of cov.result) {
      if (!script.url.startsWith("file://") || !script.url.startsWith(`file://${dist}`)) continue;
      const path = fileURLToPath(script.url);
      const hook = path.slice(dist.length + 1).replace(/\.mjs$/, "");
      if (!byHook.has(hook)) {
        const text = readFileSync(path, "utf8");
        const starts = sectionStarts(text);
        const size = new Map();
        for (let i = 0; i < starts.length; i++) {
          const end = i + 1 < starts.length ? starts[i + 1][0] : text.length;
          size.set(starts[i][1], (size.get(starts[i][1]) ?? 0) + end - starts[i][0]);
        }
        byHook.set(hook, { starts, size, called: new Set(), cases: new Set() });
      }
      const h = byHook.get(hook);
      h.cases.add(kase);
      for (const fn of script.functions) {
        const [r] = fn.ranges;
        if (r.startOffset === 0 || r.count === 0) continue; // the module itself, or never called
        h.called.add(sectionAt(h.starts, r.startOffset));
      }
    }
  }
}

for (const [hook, h] of [...byHook].sort()) {
  let total = 0, cold = 0;
  const groups = new Map();
  const coldFiles = [];
  for (const [file, n] of h.size) {
    total += n;
    const g = groups.get(groupOf(file)) ?? { total: 0, cold: 0, files: 0, coldFiles: 0 };
    g.total += n; g.files++;
    if (!h.called.has(file) && file !== "(banner)") {
      cold += n; g.cold += n; g.coldFiles++;
      coldFiles.push([n, file]);
    }
    groups.set(groupOf(file), g);
  }
  console.log(`\n## ${hook} (${[...h.cases].join(", ")}): ${total} chars, ${h.size.size - 1} files; never called: ${cold} chars (${Math.round((100 * cold) / total)}%) in ${coldFiles.length} files`);
  for (const [g, v] of [...groups].sort((a, b) => b[1].total - a[1].total).slice(0, 18)) {
    console.log(`  ${g.padEnd(22)} ${String(v.total).padStart(7)}  never called ${String(v.cold).padStart(7)} (${v.coldFiles}/${v.files} files)`);
  }
  if (listFiles) for (const [n, f] of coldFiles.sort((a, b) => b[0] - a[0]).slice(0, 40)) console.log(`    ${String(n).padStart(6)} ${f}`);
}

const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0) {
  const out = Object.fromEntries([...byHook].map(([hook, h]) => [hook, [...h.called].sort()]));
  writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out, null, 1));
}
