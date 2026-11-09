// Throwaway probe for row 018-15. For main commits near the export's commit C: per exported
// test file, is the content of CI's closure list E unchanged (options "superset" and "own run"
// accept CI's result), and is the content of E plus the union-only paths X unchanged (today's
// union key, and a re-key of the import under the local list, accept it)? Files in the first
// group and not the second are the wrong-pass exposure of the first two options. Tracked content
// only: blob ids from `git ls-tree`, listings as the names a directory holds. Read only.
// node exposure.mjs <repo> <C> <export.json> <store copy> <out.json> <commit>...
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { posix } from "node:path";
const [repo, base, exportPath, dbPath, outPath, ...commits] = process.argv.slice(2);
const exp = JSON.parse(readFileSync(exportPath, "utf8"));
const db = new DatabaseSync(dbPath, { readOnly: true });
function snapshot(commit) {
  const blobs = new Map();
  for (const l of execFileSync("git", ["-C", repo, "ls-tree", "-r", commit], { maxBuffer: 1 << 28, encoding: "utf8" }).split("\n")) {
    if (!l) continue;
    const [meta, path] = l.split("\t");
    blobs.set(path, meta.split(" ")[2]);
  }
  const names = new Map();
  for (const p of blobs.keys()) {
    let child = p;
    for (let d = posix.dirname(p); ; d = posix.dirname(d)) {
      const key = d === "." ? "./" : `${d}/`;
      if (!names.has(key)) names.set(key, new Set());
      names.get(key).add(posix.basename(child));
      if (d === ".") break;
      child = d;
    }
  }
  return (p) => (p.endsWith("/") ? (names.has(p) ? [...names.get(p)].sort().join("\0") : "absent") : blobs.get(p) ?? "absent");
}
const unions = {};
const filesOf = exp.testFiles.map((tf) => {
  unions[tf.project] ??= JSON.parse(db.prepare("select value from meta where key = ?").get(`observed.${tf.project}`)?.value ?? "{}");
  const E = tf.closure.paths;
  const Es = new Set(E);
  const X = (unions[tf.project][tf.path] ?? []).filter((p) => !Es.has(p));
  return { id: `${tf.project}:${tf.path}`, E, X };
});
const at0 = snapshot(base);
const rows = [];
const changedUnionPaths = new Map();
for (const c of commits) {
  const at = snapshot(c);
  let eqE = 0, eqL = 0, exposure = 0;
  for (const f of filesOf) {
    const e = f.E.every((p) => at(p) === at0(p));
    const changedX = f.X.filter((p) => at(p) !== at0(p));
    if (e) eqE++;
    if (e && changedX.length === 0) eqL++;
    if (e && changedX.length > 0) {
      exposure++;
      for (const p of changedX) changedUnionPaths.set(p, (changedUnionPaths.get(p) ?? 0) + 1);
    }
  }
  const distance = execFileSync("git", ["-C", repo, "rev-list", "--count", `${c}...${base}`], { encoding: "utf8" }).trim();
  rows.push({ commit: c.slice(0, 9), distance: Number(distance), eqE, eqL, exposure });
  console.log(JSON.stringify(rows.at(-1)));
}
const top = [...changedUnionPaths].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log("union-only paths changed under accepted files (file-commit pairs):");
for (const [p, n] of top) console.log(n, p);
writeFileSync(outPath, JSON.stringify({ base, rows, top }, null, 1));
