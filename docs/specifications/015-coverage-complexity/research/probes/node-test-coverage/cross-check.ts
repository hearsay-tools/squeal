// Throwaway (015-76): Squeal's join over a `drop` run against the test:coverage event of an `event`
// run of the same files. For each test file and each function the event lists inside <work>, its
// hit (count > 0) by (path, start line) against the join's ran/not-run for the counted function
// that starts on that line. Prints agreements, disagreements (with examples) and pairs only one has.
// usage: node --import tsx cross-check.ts <bench-out>/drop-<r> <bench-out>/event-<r> <work>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countFile } from "../../../../../../src/core/code/count/index.ts";
import { mapScript } from "../../../../../../src/core/code/coverage/map.ts";
import type { SourceMapLike, V8Script } from "../../../../../../src/core/code/coverage/types.ts";
import { joinCoverage } from "../../../../../../src/core/code/crap/join.ts";

const [dropDir, eventDir, work] = process.argv.slice(2) as [string, string, string];
const prefix = `file://${work}/`;
const bits = (s: ReadonlySet<number>) => {
  const b = new Uint8Array(Math.ceil((Math.max(-1, ...s) + 1) / 8) || 1);
  for (const l of s) b[l >> 3]! |= 1 << (l & 7);
  return Buffer.from(b).toString("base64");
};
const counts = new Map<string, Awaited<ReturnType<typeof countFile>>>();
let agree = 0;
let onlyEvent = 0;
const differ: string[] = [];
for (const i of readdirSync(dropDir).filter((n) => /^\d+$/.test(n))) {
  const joined = new Map<string, boolean | null>();
  for (const name of readdirSync(join(dropDir, i, "cov"))) {
    const payload = JSON.parse(readFileSync(join(dropDir, i, "cov", name), "utf8"));
    const cache: Record<string, { lineLengths: number[]; data: SourceMapLike }> = payload["source-map-cache"] ?? {};
    for (const script of payload.result as V8Script[]) {
      if (!script.url.startsWith(prefix) || script.url.includes("/node_modules/") || !/\.[cm]?[jt]s$/.test(script.url)) continue;
      const path = fileURLToPath(script.url);
      const text = readFileSync(path, "utf8");
      let count = counts.get(path);
      if (!count) counts.set(path, (count = await countFile(text, path.endsWith("ts") ? "typescript" : "javascript")));
      const entry = cache[script.url];
      const m = mapScript(script, { path: path as never, code: entry ? entry.lineLengths.map((n) => " ".repeat(n)).join("\n") : text, map: entry?.data ?? null, sha1: undefined });
      const j = joinCoverage(count.functions, [{ path: path as never, blob: "x" as never, lines: bits(m.lines), covered: bits(m.covered), functions: [...m.functions.values()] }]);
      count.functions.forEach((fn, k) => joined.set(`${path}:${fn.range.startLine}`, j[k]!.ran));
    }
  }
  for (const line of readFileSync(join(eventDir, i, "events.ndjson"), "utf8").split("\n")) {
    if (!line.includes('"test:coverage"')) continue;
    for (const f of JSON.parse(line).data.summary.files) {
      if (!f.path.startsWith(work) || f.path.includes("/node_modules/")) continue;
      for (const fn of f.functions) {
        const key = `${f.path}:${fn.line}`;
        if (!joined.has(key)) { onlyEvent++; continue; }
        if (joined.get(key) === fn.count > 0) agree++;
        else if (differ.length < 2000) differ.push(`${i} ${key.slice(work.length + 1)} event ${fn.name}:${fn.count} join ${joined.get(key)}`);
      }
    }
  }
}
console.log(JSON.stringify({ agree, differ: differ.length, onlyEvent, examples: differ.slice(0, 8) }, null, 1));
