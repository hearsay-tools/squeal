// Throwaway (015-76): how many of Squeal's counted functions a node:test record joins to, at scale.
// For each test file of a `drop` bench run: map every own script (source-map-cache map, else the
// file as its own code) with Squeal's mapScript and join it to countFile's functions with D9's
// joinCoverage. Counts each (test file, function) pair as ran, not run, or unknown (no V8 function
// joined and the body cannot tell), split by whether the source went through a loader's map.
// usage: node --import tsx join-rate.ts <bench-out>/drop-<round> <work>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countFile } from "../../../../../../src/core/code/count/index.ts";
import { mapScript } from "../../../../../../src/core/code/coverage/map.ts";
import type { SourceMapLike, V8Script } from "../../../../../../src/core/code/coverage/types.ts";
import { joinCoverage } from "../../../../../../src/core/code/crap/join.ts";

const [dir, work] = process.argv.slice(2) as [string, string];
const prefix = `file://${work}/`;
const bits = (s: ReadonlySet<number>) => {
  const b = new Uint8Array(Math.ceil((Math.max(-1, ...s) + 1) / 8) || 1);
  for (const l of s) b[l >> 3]! |= 1 << (l & 7);
  return Buffer.from(b).toString("base64");
};
const counts = new Map<string, Awaited<ReturnType<typeof countFile>>>();
const tally: Record<string, { ran: number; not: number; unknown: number; examples: string[] }> = {};
for (const i of readdirSync(dir).filter((n) => /^\d+$/.test(n))) {
  const cov = join(dir, i, "cov");
  for (const name of readdirSync(cov)) {
    const payload = JSON.parse(readFileSync(join(cov, name), "utf8"));
    const cache: Record<string, { lineLengths: number[]; data: SourceMapLike }> = payload["source-map-cache"] ?? {};
    for (const script of payload.result as V8Script[]) {
      if (!script.url.startsWith(prefix) || script.url.includes("/node_modules/")) continue;
      const path = fileURLToPath(script.url);
      if (!/\.[cm]?[jt]s$/.test(path)) continue;
      const text = readFileSync(path, "utf8");
      let count = counts.get(path);
      if (!count) counts.set(path, (count = await countFile(text, path.endsWith("ts") ? "typescript" : "javascript")));
      const entry = cache[script.url];
      const code = entry ? entry.lineLengths.map((n) => " ".repeat(n)).join("\n") : text;
      const m = mapScript(script, { path: path as never, code, map: entry?.data ?? null, sha1: undefined });
      const joined = joinCoverage(count.functions, [
        { path: path as never, blob: "x" as never, lines: bits(m.lines), covered: bits(m.covered), functions: [...m.functions.values()] },
      ]);
      const kind = entry ? "through a source map" : "no map";
      const t = (tally[kind] ??= { ran: 0, not: 0, unknown: 0, examples: [] });
      joined.forEach((j, k) => {
        if (j.ran === true) t.ran++;
        else if (j.ran === false) t.not++;
        else {
          t.unknown++;
          const fn = count.functions[k]!;
          if (t.examples.length < 5) t.examples.push(`${path.slice(work.length + 1)}:${fn.range.startLine} ${fn.qualifiedName}`);
        }
      });
    }
  }
}
console.log(JSON.stringify({ dir, sources: counts.size, tally }, null, 1));
