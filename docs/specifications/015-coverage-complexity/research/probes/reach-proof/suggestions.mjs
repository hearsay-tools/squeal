// Row 015-114: count the suggestion defects in a `squeal reach --json` answer.
// Usage: node suggestions.mjs <reach.json> <clone root> [top n]
// - noted: the main route is a child process or runtime read, yet the entry has
//   avoidable seconds and its import kinds carry more seconds than the noted kind
//   (the JSON gives that entry a `note` and no suggestion);
// - zero: a helper suggestion whose count of test files that never call it is 0;
// - values: "holds no functions" on a file that exports a runtime value.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [jsonPath, root, topArg] = process.argv.slice(2);
const report = JSON.parse(readFileSync(jsonPath, "utf8"));
const top = Number(topArg ?? report.files.length);
const IMPORT = ["barrel", "test helper", "transitive", "direct", "import"];
const VALUE = /^export\s+(const|let|var|function|async\s+function|class|enum|default)\b|^export\s*\{(?!\s*type\b)/m;
const out = { entries: 0, suggestions: 0, noted: [], zero: [], values: [], typeOnly: [] };
for (const [i, e] of report.files.slice(0, top).entries()) {
  out.entries++;
  const s = e.suggestion;
  if (s || e.note) out.suggestions++;
  const importShare = IMPORT.reduce((n, k) => n + (e.kinds[k] ?? 0), 0);
  const noted = (e.kinds["runtime read"] ?? 0) + (e.kinds["child process"] ?? 0);
  if (e.note && e.avoidableSeconds > 0 && importShare > noted) out.noted.push(`#${i + 1} ${e.files[0]}${e.files.length > 1 ? ` (+${e.files.length - 1})` : ""}: import ${Math.round(importShare * 100)}%, noted ${Math.round(noted * 100)}%, avoidable ${Math.round(e.avoidableSeconds)} s`);
  if (s && /: 0 of the \d+ test files/.test(s.text)) out.zero.push(`#${i + 1} ${e.files[0]}: ${s.text}`);
  if (s && /holds no functions/.test(s.text)) {
    for (const f of e.files) {
      let src = "";
      try { src = readFileSync(join(root, f), "utf8"); } catch {}
      (VALUE.test(src) ? out.values : out.typeOnly).push(`#${i + 1} ${f}`);
    }
  }
}
console.log(`${jsonPath}, first ${out.entries} entries, ${out.suggestions} with a suggestion or note`);
console.log(`  by-design note on an entry whose import kinds outweigh it, with avoidable seconds: ${out.noted.length}`);
for (const l of out.noted.slice(0, 8)) console.log(`    ${l}`);
console.log(`  helper suggestion with 0 test files that never call the file: ${out.zero.length}`);
for (const l of out.zero.slice(0, 4)) console.log(`    ${l}`);
console.log(`  "holds no functions" files that export a value: ${out.values.length}; that export types only: ${out.typeOnly.length}`);
for (const l of out.values.slice(0, 8)) console.log(`    ${l}`);
