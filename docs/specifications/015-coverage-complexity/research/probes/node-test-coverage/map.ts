// Throwaway (015-76): maps one run's NODE_V8_COVERAGE files through Squeal's own D8 mapping
// (src/core/code/coverage/map.ts) and joins them to Squeal's counted functions (D9's join), in
// three ways, to see which code V8's offsets index under a loader:
//   A  code = the source file on disk, no map (what holds under type stripping)
//   B  code = blank lines of the lengths in the payload's source-map-cache, map = that cache's map
//   D  as B, but mapScript's closing-punctuation rule read at the mapped source position (the
//      executed code is not in the payload, only its line lengths); functions as B
// and prints the test:coverage event of an `event` run of the same file beside them.
// usage: node --import tsx map.ts <raw-out> <root> [event-out]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countFile } from "../../../../../../src/core/code/count/index.ts";
import { mapScript } from "../../../../../../src/core/code/coverage/map.ts";
import { Counts } from "../../../../../../src/core/code/coverage/ranges.ts";
import { decodeMappings } from "../../../../../../src/core/code/coverage/sourcemap.ts";
import type { SourceMapLike, V8Script } from "../../../../../../src/core/code/coverage/types.ts";
import { joinCoverage } from "../../../../../../src/core/code/crap/join.ts";

const [rawOut, root, eventOut] = process.argv.slice(2) as [string, string, string | undefined];
const rootUrl = `file://${root}/`;
const own = (url: string) => url.startsWith(rootUrl) && !url.includes("/node_modules/");

// The test file's own process: the pid of the graph file that holds a non-preload edge with no parent.
const testPid = readdirSync(rawOut)
  .filter((n) => n.startsWith("graph-"))
  .find((n) =>
    readFileSync(join(rawOut, n), "utf8")
      .split("\n")
      .filter(Boolean)
      .some((l) => {
        const e = JSON.parse(l);
        return e.parent === null && e.preload !== true;
      }),
  )
  ?.slice(6, -7);
const covDir = join(rawOut, "cov");
const byPid = new Map<string, string[]>();
for (const n of readdirSync(covDir)) {
  const pid = n.split("-")[1] ?? "";
  byPid.set(pid, [...(byPid.get(pid) ?? []), n]);
}
console.log(`test pid ${testPid}; coverage files by pid:`, Object.fromEntries([...byPid].map(([p, f]) => [p, f.length])));

for (const [pid, names] of byPid) {
  for (const name of names) {
    const payload = JSON.parse(readFileSync(join(covDir, name), "utf8"));
    const cache: Record<string, { lineLengths: number[]; data: SourceMapLike }> = payload["source-map-cache"] ?? {};
    for (const script of payload.result as V8Script[]) {
      if (!own(script.url)) continue;
      const path = fileURLToPath(script.url);
      const text = readFileSync(path, "utf8");
      const count = await countFile(text, "typescript");
      const entry = cache[script.url];
      const variants: [string, string, SourceMapLike | null][] = [["A", text, null]];
      if (entry) variants.push(["B", entry.lineLengths.map((n) => " ".repeat(n)).join("\n"), entry.data]);
      console.log(`\n${pid === testPid ? "TEST" : "OTHER"} pid ${pid} ${name.split("-").slice(2).join("-")} ${path.slice(root.length + 1)} (source ${text.split("\n").length} lines${entry ? `, executed ${entry.lineLengths.length} lines` : ", no source map"})`);
      if (entry) variants.push(["D", "", entry.data]);
      const results = variants.map(([label, c, map]) => {
        const mapped =
          label === "D" && entry
            ? sourceSide(script, entry, text, mapScript(script, { path: path as never, code: variants[1]![1], map, sha1: undefined }))
            : mapScript(script, { path: path as never, code: c, map, sha1: undefined });
        const toBits = (s: ReadonlySet<number>) => {
          const b = new Uint8Array(Math.ceil((Math.max(-1, ...s) + 1) / 8) || 1);
          for (const l of s) b[l >> 3]! |= 1 << (l & 7);
          return Buffer.from(b).toString("base64");
        };
        const joined = joinCoverage(count.functions, [
          { path: path as never, blob: "x" as never, lines: toBits(mapped.lines), covered: toBits(mapped.covered), functions: [...mapped.functions.values()] },
        ]);
        return { label, mapped, joined };
      });
      for (const { label, mapped } of results) {
        console.log(`  ${label} lines ${[...mapped.lines].sort((a, b) => a - b).map((l) => l + 1).join(",")}`);
        console.log(`  ${label} covered ${[...mapped.covered].sort((a, b) => a - b).map((l) => l + 1).join(",")}`);
      }
      count.functions.forEach((fn, i) => {
        const cells = results.map(({ label, joined }) => {
          const j = joined[i]!;
          return `${label}:${j.ran === null ? "?" : j.ran ? "ran" : "not"} ${j.covered}/${j.lines}`;
        });
        console.log(`  ${fn.qualifiedName.padEnd(24)} L${fn.range.startLine}-${fn.range.endLine}  ${cells.join("  ")}`);
      });
    }
  }
}

if (eventOut) {
  for (const line of readFileSync(join(eventOut, "events.ndjson"), "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.type !== "test:coverage") continue;
    for (const f of e.data.summary.files) {
      console.log(`\nEVENT ${f.path}`);
      console.log(`  functions ${f.functions.map((fn: { name: string; line: number; count: number }) => `${fn.name || "(anon)"}@${fn.line}:${fn.count}`).join(" ")}`);
      console.log(`  lines listed ${f.lines.length} of ${f.totalLineCount}; count>0: ${f.lines.filter((l: { count: number }) => l.count > 0).map((l: { line: number }) => l.line).join(",")}`);
    }
  }
}

/** Variant D: lines from the map's segments, skipping a segment whose source character closes. */
function sourceSide(
  script: V8Script,
  entry: { lineLengths: number[]; data: SourceMapLike },
  source: string,
  base: ReturnType<typeof mapScript>,
): ReturnType<typeof mapScript> {
  const counts = new Counts(script.functions, 0);
  const sourceLines = source.split("\n");
  const lines = new Set<number>();
  const covered = new Set<number>();
  let start = 0;
  decodeMappings(entry.data.mappings as string).forEach((segments, line) => {
    for (const [column, src, sourceLine, sourceColumn] of segments) {
      if (src !== 0) continue;
      if (/^[})\];,]$/.test(sourceLines[sourceLine]?.charAt(sourceColumn) ?? "")) continue;
      const count = counts.at(start + column);
      if (count === null) continue;
      lines.add(sourceLine);
      if (count > 0) covered.add(sourceLine);
    }
    start += (entry.lineLengths[line] ?? 0) + 1;
  });
  return { lines, covered, functions: base.functions };
}
