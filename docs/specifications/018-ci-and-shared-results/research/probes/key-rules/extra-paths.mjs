// Throwaway probe for row 018-15: which union-only paths move keys, counted by path across files.
// node extra-paths.mjs <store copy> <export.json> <tree.txt>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [dbPath, exportPath, treePath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const exp = JSON.parse(readFileSync(exportPath, "utf8"));
const files = new Set(readFileSync(treePath, "utf8").split("\n").filter(Boolean));
const unions = {};
const count = new Map();
let untrackedOther = new Map();
for (const tf of exp.testFiles) {
  unions[tf.project] ??= JSON.parse(db.prepare("select value from meta where key = ?").get(`observed.${tf.project}`)?.value ?? "{}");
  const E = new Set(tf.closure.paths);
  for (const p of unions[tf.project][tf.path] ?? []) {
    if (E.has(p)) continue;
    const m = files.has(p) || p.endsWith("/") ? count : untrackedOther;
    m.set(p, (m.get(p) ?? 0) + 1);
  }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log("distinct key-moving extra paths", count.size, "distinct untracked extra paths", untrackedOther.size);
console.log("top key-moving:"); for (const [p, n] of top(count, 40)) console.log(n, p);
console.log("top untracked:"); for (const [p, n] of top(untrackedOther, 25)) console.log(n, p);
