import { readFileSync } from "node:fs"; import { DatabaseSync } from "node:sqlite";
const [, , contentPath, missW, priorW] = process.argv;
const g = JSON.parse(readFileSync("/tmp/ms152/an/growth-squeal.json", "utf8"));
const db = new DatabaseSync("/tmp/ms152/stores/squeal/store.sqlite", { readOnly: true });
const ob = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='observed.'").get().value);
const rows = readFileSync(contentPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => o.cls === "equal content stored before, different key" && (!missW || o.w === missW));
const out = {}; let none = 0, n = 0;
for (const o of rows) {
  const e = o.equalContent.filter((x) => !priorW || x.w === priorW).at(-1); if (!e) continue; n++;
  const p = o.file.split("\0")[1]; const set = new Set(ob[p] ?? []); const f = g[o.file] ?? {};
  const newer = [...set].filter((q) => f[q] !== undefined && f[q] > e.at && f[q] < o.ckStart);
  if (!newer.length) none++; for (const q of newer) out[q] = (out[q] ?? 0) + 1;
}
console.log(`files ${n}; with an observed path first reported between the two runs: ${n - none}`); console.log(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 12));
