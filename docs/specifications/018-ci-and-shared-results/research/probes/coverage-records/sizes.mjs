// Throwaway probe for research/coverage-records.md, question 1 (sizes).
// Usage: node sizes.mjs <download dir of one run> [<download dir of a second run>]
// The download dir holds squeal-parts-shard-*/*.json and squeal-results/squeal-results.json.gz
// from `gh run download <run> -R hearsay-tools/squawk`. Reads only; writes nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, gunzipSync, gzipSync, brotliCompressSync, constants } from "node:zlib";
import * as zlib from "node:zlib";
const zstdCompressSync = zlib.zstdCompressSync;

const dir = process.argv[2];
const second = process.argv[3];

function load(dir) {
  const parts = readdirSync(dir)
    .filter((d) => d.startsWith("squeal-parts-shard-"))
    .flatMap((d) =>
      readdirSync(join(dir, d)).map((f) => JSON.parse(readFileSync(join(dir, d, f), "utf8"))),
    );
  const exportPath = join(dir, "squeal-results", "squeal-results.json.gz");
  const exp = JSON.parse(gunzipSync(readFileSync(exportPath)).toString("utf8"));
  return { parts, exp, exportBytes: statSync(exportPath).size };
}

const id = (f) => `${f.project}\0${f.path}`;
const text = (s) => {
  const { path, blob, lines, covered, functions } = s;
  return JSON.stringify({ path, blob, lines, covered, functions });
};
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const gz = (o) => gzipSync(typeof o === "string" ? o : JSON.stringify(o)).length;
const br = (o) =>
  brotliCompressSync(typeof o === "string" ? o : JSON.stringify(o), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
  }).length;

/** Every test file's record, inline (`partRecord`'s shape), keyed by project and path. */
function records(parts) {
  const out = new Map();
  const noRecord = new Map();
  for (const part of parts) {
    for (const f of part.testFiles) {
      if (f.record === undefined) {
        noRecord.set(f.noRecord ?? "none", (noRecord.get(f.noRecord ?? "none") ?? 0) + 1);
        continue;
      }
      const r = part.coverage.records[f.record];
      const sources = r.sources.map((at) => part.coverage.sources[at]);
      out.set(id(f), { v: 1, sources, unread: r.unread });
    }
  }
  return { out, noRecord };
}

/** One table of distinct source entries, and per file the indices into it. */
function deduped(recs, keep) {
  const index = new Map();
  const sources = [];
  const byFile = {};
  for (const [k, r] of recs) {
    if (keep && !keep.has(k)) continue;
    byFile[k] = {
      sources: r.sources.map((s) => {
        const t = text(s);
        let at = index.get(t);
        if (at === undefined) {
          at = sources.push(s) - 1;
          index.set(t, at);
        }
        return at;
      }),
      unread: r.unread,
    };
  }
  return { sources, byFile, index };
}

const a = load(dir);
const { out: recs, noRecord } = records(a.parts);
const partFiles = a.parts.reduce((n, p) => n + p.testFiles.length, 0);
const exported = new Set(a.exp.testFiles.map(id));
console.log(`run dir: ${dir}`);
console.log(`parts: ${a.parts.length}, files in parts: ${partFiles}, with record: ${recs.size}`);
console.log(`no record by reason: ${JSON.stringify(Object.fromEntries(noRecord))}`);
console.log(
  `part JSON bytes: ${a.parts.map((p) => mb(Buffer.byteLength(JSON.stringify(p)))).join(", ")}`,
);
console.log(
  `part coverage section bytes: ${a.parts.map((p) => mb(Buffer.byteLength(JSON.stringify(p.coverage ?? {})))).join(", ")}`,
);
console.log(`export: ${a.exp.testFiles.length} files, ${a.exp.results.length} results`);
const exportedWithRecord = [...exported].filter((k) => recs.has(k)).length;
console.log(`exported files with a record: ${exportedWithRecord} of ${exported.size}`);

// Per file sizes, as the store keeps one (encodeRecord: deflated JSON) and as raw JSON.
const raw = [];
const deflated = [];
const nsrc = [];
for (const [k, r] of recs) {
  if (!exported.has(k)) continue;
  const t = JSON.stringify(r);
  raw.push(Buffer.byteLength(t));
  deflated.push(deflateRawSync(t).length);
  nsrc.push(r.sources.length);
}
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
console.log("\nper exported test file record:");
console.log(
  `  sources per record: median ${q(nsrc, 0.5)}, p95 ${q(nsrc, 0.95)}, max ${Math.max(...nsrc)}`,
);
console.log(
  `  raw JSON: median ${kb(q(raw, 0.5))}, p95 ${kb(q(raw, 0.95))}, max ${kb(Math.max(...raw))}, total ${mb(sum(raw))}`,
);
console.log(
  `  deflated alone (encodeRecord): median ${kb(q(deflated, 0.5))}, p95 ${kb(q(deflated, 0.95))}, total ${mb(sum(deflated))}`,
);

// Export variants, all through gzipSync(JSON.stringify(...)) as transfer-bundle.ts writes it.
const base = gz(a.exp);
console.log(`\nexport file on disk: ${mb(a.exportBytes)}; re-gzipped here: ${mb(base)}`);
const inline = {
  ...a.exp,
  testFiles: a.exp.testFiles.map((f) => ({ ...f, coverage: recs.get(id(f)) ?? null })),
};
const all = deduped(recs, exported);
const table = {
  ...a.exp,
  coverage: { sources: all.sources, records: a.exp.testFiles.map((f) => all.byFile[id(f)] ?? null) },
};
const onlyRecords = { coverage: table.coverage };
const vInline = gz(inline);
const vTable = gz(table);
const vOnly = gz(onlyRecords);
const rawTable = Buffer.byteLength(JSON.stringify(table.coverage));
console.log(
  `distinct source entries over exported records: ${all.sources.length} (of ${sum(nsrc)} references)`,
);
console.log(`records table raw JSON: ${mb(rawTable)}`);
console.log(`export + inline records, gzip: ${mb(vInline)} (x${(vInline / base).toFixed(2)})`);
console.log(`export + deduped table, gzip: ${mb(vTable)} (x${(vTable / base).toFixed(2)})`);
console.log(`records alone (separate ref), gzip: ${mb(vOnly)}; brotli q9: ${mb(br(onlyRecords))}`);
console.log(`export alone, brotli q9: ${mb(br(a.exp))}`);

// Distinct sources by path: how many entries per path (hits differ between test files).
const perPath = new Map();
for (const s of all.sources) perPath.set(s.path, (perPath.get(s.path) ?? 0) + 1);
const pp = [...perPath.values()];
console.log(
  `distinct paths: ${perPath.size}; entries per path: median ${q(pp, 0.5)}, p95 ${q(pp, 0.95)}, max ${Math.max(...pp)}`,
);
// Field shares inside the table.
const fieldBytes = { path: 0, blob: 0, lines: 0, covered: 0, functions: 0 };
for (const s of all.sources) for (const k of Object.keys(fieldBytes)) fieldBytes[k] += Buffer.byteLength(JSON.stringify(s[k]));
console.log(`table bytes by field (raw): ${JSON.stringify(Object.fromEntries(Object.entries(fieldBytes).map(([k, v]) => [k, mb(v)])))}`);

// Compressors on the records table alone.
{
  const t = JSON.stringify(onlyRecords);
  const timed = (name, f) => {
    const t0 = process.hrtime.bigint();
    const n = f().length;
    console.log(`  ${name}: ${mb(n)} in ${Number(process.hrtime.bigint() - t0) / 1e6 | 0} ms`);
  };
  console.log("\nrecords table alone by compressor:");
  timed("gzip 6", () => gzipSync(t));
  timed("gzip 9", () => gzipSync(t, { level: 9 }));
  timed("brotli q5 lgwin 24", () => brotliCompressSync(t, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_LGWIN]: 24 } }));
  timed("brotli q9 lgwin 24", () => brotliCompressSync(t, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24 } }));
  if (typeof zstdCompressSync === "function") {
    timed("zstd 3", () => zstdCompressSync(t));
    timed("zstd 19", () => zstdCompressSync(t, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }));
  }
}

// Split form: what is equal for one (path, blob) once (lines, function spans),
// and per source entry only its hits (covered lines bitset, function hit bits).
{
  const shapes = new Map();
  const shapeList = [];
  const entries = all.sources.map((s) => {
    const spans = s.functions.map((f) => f.slice(0, 4));
    const key = JSON.stringify([s.path, s.blob, s.lines, spans]);
    let at = shapes.get(key);
    if (at === undefined) {
      at = shapeList.push({ path: s.path, blob: s.blob, lines: s.lines, spans }) - 1;
      shapes.set(key, at);
    }
    const bits = Buffer.alloc(Math.ceil(s.functions.length / 8));
    s.functions.forEach((f, i) => {
      if (f[4]) bits[i >> 3] |= 1 << (i & 7);
    });
    return [at, s.covered, bits.toString("base64")];
  });
  const split = { shapes: shapeList, entries, records: onlyRecords.coverage.records };
  console.log(`\nsplit form: ${shapeList.length} shapes (path, blob, lines, spans), ${entries.length} hit entries`);
  console.log(`  raw ${mb(Buffer.byteLength(JSON.stringify(split)))}, gzip ${mb(gz(split))}, brotli q9 ${mb(br(split))}`);
  console.log(`  export + split, gzip: ${mb(gz({ ...a.exp, coverage: split }))}`);
}

// Records of the files the parts hold but the export leaves out.
console.log(`\nall ${recs.size} part records deduped, gzip: ${mb(gz({ coverage: (() => { const d = deduped(recs); return { sources: d.sources, records: Object.values(d.byFile) }; })() }))}`);

if (second) {
  const b = load(second);
  const { out: recsB } = records(b.parts);
  const expB = new Set(b.exp.testFiles.map(id));
  const tb = deduped(recsB, expB);
  let shared = 0;
  let sharedBytes = 0;
  let total = 0;
  for (const s of tb.sources) {
    const t = text(s);
    total += Buffer.byteLength(t);
    if (all.index.has(t)) {
      shared++;
      sharedBytes += Buffer.byteLength(t);
    }
  }
  console.log(`\nsecond run dir: ${second}: ${b.exp.header.commit.slice(0, 8)} vs ${a.exp.header.commit.slice(0, 8)}`);
  console.log(
    `source entries of the second also in the first: ${shared} of ${tb.sources.length} (${((100 * shared) / tb.sources.length).toFixed(1)}%), bytes ${((100 * sharedBytes) / total).toFixed(1)}%`,
  );
  let sameRecord = 0;
  for (const [k, r] of recsB) {
    if (!expB.has(k)) continue;
    const o = recs.get(k);
    if (o && JSON.stringify(o) === JSON.stringify(r)) sameRecord++;
  }
  console.log(`exported records equal in both runs: ${sameRecord} of ${expB.size}`);
}
