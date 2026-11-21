// usage: node same-bytes.mjs <a.json.gz> <b.json.gz>: equal after setting header.createdAt to 0?
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const read = (f) => {
  const text = gunzipSync(readFileSync(f)).toString("utf8");
  const v = JSON.parse(text);
  v.header.createdAt = 0;
  return { text: JSON.stringify(v), files: v.testFiles.length, results: v.results.length, raw: text.length };
};
const [a, b] = process.argv.slice(2).map(read);
console.log(`a: ${a.files} files, ${a.results} results, ${a.raw} bytes; b: ${b.files} files, ${b.results} results, ${b.raw} bytes`);
console.log(a.text === b.text ? "EQUAL except createdAt" : "DIFFERENT");
process.exit(a.text === b.text ? 0 : 1);
