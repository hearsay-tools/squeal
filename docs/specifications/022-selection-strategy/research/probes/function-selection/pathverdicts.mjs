import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const { pairs } = JSON.parse(readFileSync(f, "utf8"));
  const c = {}; let total = 0;
  for (const p of pairs) { const v = p.relaxed?.verdicts ?? p.verdicts; if (!v) continue; for (const [, x] of v) { c[x] = (c[x] ?? 0) + 1; total++; } }
  const loaded = Object.entries(c).filter(([k]) => !/scriptNotLoaded|nonScript|testFile|noOldBlob|noNewBlob|unread|blobMismatch/.test(k));
  const L = loaded.reduce((a, [, n]) => a + n, 0);
  console.log(f, "path-pairs", total, "loaded-judged", L, "bodiesOnly", c.bodiesOnly ?? 0, ((c.bodiesOnly ?? 0) / total * 100).toFixed(2) + "% of all", ((c.bodiesOnly ?? 0) / L * 100).toFixed(2) + "% of loaded");
  console.log("  ", JSON.stringify(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10)));
}
