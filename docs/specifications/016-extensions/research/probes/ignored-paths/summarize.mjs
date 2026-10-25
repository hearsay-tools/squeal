// Throwaway (016-19). A compact breakdown of one analyze.mjs result: ignored file paths
// and listings grouped by pattern (UUIDs, hex ids and long numbers as `*`, two levels
// below a `.tmp`), by kind, and the test directories that read them.
// Usage: node summarize.mjs <result.json>
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const norm = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{12,}|\b\d{5,}\b|\.tmp-[^/]+|unit-env-[^/]+/g, "*")
  .split("/").slice(0, p.startsWith("packages/") ? 4 : 4).join("/");
const tally = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {}))
  .sort((a, b) => b[1] - a[1]).slice(0, 12);
const kinds = {};
const testDirs = {};
for (const [t, per] of Object.entries(r.perTest)) {
  const dir = t.split("/").slice(0, t.startsWith("packages/") ? 3 : 2).join("/");
  for (const [k, ps] of Object.entries(per)) {
    kinds[k] ??= new Set();
    for (const p of ps) kinds[k].add(p);
    if (k !== "l") testDirs[dir] = (testDirs[dir] ?? 0) + ps.length;
  }
}
const files = r.files;
const exists = r.existsNow;
console.log(JSON.stringify({
  tests: r.tests, testsWithIgnored: r.testsWithIgnored, ignoredFiles: files.length, ignoredListings: r.listings.length,
  existsAfterRun: exists, byKind: Object.fromEntries(Object.entries(kinds).map(([k, s]) => [k, s.size])),
  filesByPattern: tally(files, norm), listingsByPattern: tally(r.listings, norm),
  testDirsByFileReads: Object.entries(testDirs).sort((a, b) => b[1] - a[1]).slice(0, 10),
  bounds: Object.fromEntries(Object.entries(r.bounds).map(([k, v]) => [k, { kept: v.kept, sample: v.sample }])),
  perTestMax: r.perTestMax, perTestMedianAmongThose: r.perTestMedianAmongThose,
}, null, 1));
