// Throwaway (015-01): read NODE_V8_COVERAGE output, print math.ts functions with
// source text at each range, to see whether offsets match the .ts source.
import { readdirSync, readFileSync } from "node:fs";
const [dir, source] = process.argv.slice(2);
const text = readFileSync(source, "utf8");
for (const f of readdirSync(dir)) {
  const data = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  for (const s of data.result.filter((s) => s.url.endsWith("/math.ts"))) {
    console.log(f.slice(0, 20), s.functions.filter((fn) => fn.functionName).map((fn) => `${fn.functionName}:${fn.ranges[0].count} "${text.slice(fn.ranges[0].startOffset, fn.ranges[0].startOffset + 20).replace(/\n/g, " ")}"`).join(" | "));
  }
}
