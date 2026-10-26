// Throwaway (015-76): what turning one bench run's payloads into D8 records costs on one thread.
// For each test file of a `drop` (or `raw`) run of bench.mjs: read and parse every coverage file of
// it, keep the scripts inside <work> outside node_modules, map each through Squeal's mapScript (the
// payload's source-map-cache map when it has one, else the file on disk as its own code), and build
// the compact record (bitsets as in record.ts). For an `event` run: parse the test:coverage event.
// usage: node --import tsx map-cost.ts <bench-out>/<mode>-<round> <work> <drop|raw|event>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapScript } from "../../../../../../src/core/code/coverage/map.ts";
import type { SourceMapLike, V8Script } from "../../../../../../src/core/code/coverage/types.ts";

const [dir, work, mode] = process.argv.slice(2) as [string, string, string];
const prefix = `file://${work}/`;
const bitset = (s: ReadonlySet<number>) => {
  const b = new Uint8Array(Math.ceil((Math.max(-1, ...s) + 1) / 8) || 1);
  for (const l of s) b[l >> 3]! |= 1 << (l & 7);
  return Buffer.from(b).toString("base64");
};
const rows: { raw: number; scripts: number; own: number; parseMs: number; mapMs: number; record: number }[] = [];
for (const i of readdirSync(dir).filter((n) => /^\d+$/.test(n)).sort((a, b) => +a - +b)) {
  if (mode === "event") {
    const t0 = performance.now();
    const text = readFileSync(join(dir, i, "events.ndjson"), "utf8");
    let raw = 0;
    let own = 0;
    for (const line of text.split("\n")) {
      if (!line.includes('"test:coverage"')) continue;
      raw += line.length;
      const e = JSON.parse(line);
      own += e.data.summary.files.filter((f: { path: string }) => f.path.startsWith(work) && !f.path.includes("/node_modules/")).length;
    }
    rows.push({ raw, scripts: 0, own, parseMs: performance.now() - t0, mapMs: 0, record: 0 });
    continue;
  }
  const cov = join(dir, i, "cov");
  let raw = 0;
  let scripts = 0;
  let parseMs = 0;
  let mapMs = 0;
  const sources: unknown[] = [];
  for (const name of readdirSync(cov)) {
    raw += statSync(join(cov, name)).size;
    const t0 = performance.now();
    const payload = JSON.parse(readFileSync(join(cov, name), "utf8"));
    const t1 = performance.now();
    parseMs += t1 - t0;
    const cache: Record<string, { lineLengths: number[]; data: SourceMapLike }> = payload["source-map-cache"] ?? {};
    for (const script of payload.result as V8Script[]) {
      scripts++;
      if (!script.url.startsWith(prefix) || script.url.includes("/node_modules/")) continue;
      const entry = cache[script.url];
      const code = entry ? entry.lineLengths.map((n) => " ".repeat(n)).join("\n") : readFileSync(fileURLToPath(script.url), "utf8");
      const m = mapScript(script, { path: script.url as never, code, map: entry?.data ?? null, sha1: undefined });
      sources.push({ path: script.url.slice(prefix.length), lines: bitset(m.lines), covered: bitset(m.covered), functions: [...m.functions.values()] });
    }
    mapMs += performance.now() - t1;
  }
  rows.push({ raw, scripts, own: sources.length, parseMs, mapMs, record: JSON.stringify({ v: 1, sources, unread: [] }).length });
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const f = (k: keyof (typeof rows)[number]) => rows.map((r) => r[k]);
console.log(JSON.stringify({
  dir, mode, files: rows.length,
  rawKiB: { mean: Math.round(sum(f("raw")) / rows.length / 1024), median: Math.round(med(f("raw")) / 1024) },
  scriptsPerFile: Math.round(sum(f("scripts")) / rows.length),
  ownSourcesPerFile: +(sum(f("own")) / rows.length).toFixed(1),
  parseMsPerFile: { mean: +(sum(f("parseMs")) / rows.length).toFixed(1), median: +med(f("parseMs")).toFixed(1) },
  mapMsPerFile: { mean: +(sum(f("mapMs")) / rows.length).toFixed(1), median: +med(f("mapMs")).toFixed(1) },
  recordKiBPerFile: +(sum(f("record")) / rows.length / 1024).toFixed(1),
}));
