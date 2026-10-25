// Throwaway probe (row 015-58): maps the child's V8 functions back to assemble.ts.
import { readdirSync, readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [covDir, bundle, outJson] = process.argv.slice(2);
const url = pathToFileURL(resolve(bundle)).href;
const text = readFileSync(bundle, "utf8");
const map = new SourceMap(JSON.parse(readFileSync(`${bundle}.map`, "utf8")));
const starts = [0];
for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
const position = (offset) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: offset - starts[lo] };
};
const outputs = JSON.parse(readFileSync(outJson, "utf8"));
const errors = Object.entries(outputs).filter(([, o]) => o.error !== undefined);
console.log(`cases run: ${Object.keys(outputs).length}, with an error: ${errors.length}`);
const seen = new Map();
for (const name of readdirSync(covDir).filter((n) => n.endsWith(".json"))) {
  const report = JSON.parse(readFileSync(`${covDir}/${name}`, "utf8"));
  for (const script of report.result.filter((s) => s.url === url)) {
    for (const fn of script.functions) {
      const range = fn.ranges[0];
      const { line, column } = position(range.startOffset);
      const entry = map.findEntry(line, column);
      const source = entry?.originalSource ?? "";
      if (!source.endsWith("test/keys/validity/harness/assemble.ts")) continue;
      const key = `${(entry.originalLine ?? 0) + 1}:${fn.functionName || "(anonymous)"}`;
      seen.set(key, (seen.get(key) ?? 0) + range.count);
    }
  }
}
console.log("assemble.ts functions in the child (source line:name -> calls):");
for (const [key, count] of [...seen].sort((a, b) => Number.parseInt(a[0]) - Number.parseInt(b[0])))
  console.log(`  ${key} -> ${count}`);
