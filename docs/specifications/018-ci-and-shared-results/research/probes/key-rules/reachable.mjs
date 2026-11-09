// Throwaway probe for row 018-15. For each exported test file F and each key-moving path X the
// union adds over CI's own run: does any file in CI's closure list of F, at the trial commit,
// name X (its file name without extension)? Named: F's code at this content can reach X, so CI's
// run not reading X means a read that varies between runs. Not named: X came from other content.
// Heuristic: a name built at run time is missed. Read only (git cat-file on the given repository).
// node reachable.mjs <repo> <commit> <export.json> <union-extras.json> <store copy>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { posix } from "node:path";
const [repo, commit, exportPath, extrasPath, dbPath] = process.argv.slice(2);
const exp = JSON.parse(readFileSync(exportPath, "utf8"));
const { perFile } = JSON.parse(readFileSync(extrasPath, "utf8"));
const db = new DatabaseSync(dbPath, { readOnly: true });
const tree = execFileSync("git", ["-C", repo, "ls-tree", "-r", commit], { maxBuffer: 1 << 28, encoding: "utf8" })
  .split("\n").filter(Boolean).map((l) => { const [meta, path] = l.split("\t"); return [path, meta.split(" ")[2]]; });
const blobOf = new Map(tree);
const files = new Set(blobOf.keys());
const text = new Map();
function read(path) {
  if (!text.has(path)) {
    const b = blobOf.get(path);
    text.set(path, b ? execFileSync("git", ["-C", repo, "cat-file", "blob", b], { maxBuffer: 1 << 28, encoding: "latin1" }) : "");
  }
  return text.get(path);
}
const unions = {};
const stem = (p) => posix.basename(p).replace(/\.(m?[jt]s|tsx?|json)$/, "");
let pairs = 0, named = 0, unnamed = 0;
const filesWithNamed = new Set(), filesAllUnnamed = new Set();
const sample = [];
for (const f of perFile) {
  if (f.X === 0) continue;
  const tf = exp.testFiles.find((t) => t.project === f.project && t.path === f.path);
  unions[f.project] ??= JSON.parse(db.prepare("select value from meta where key = ?").get(`observed.${f.project}`).value);
  const E = new Set(tf.closure.paths);
  const X = (unions[f.project][f.path] ?? []).filter((p) => !E.has(p) && (files.has(p)));
  if (X.length === 0) continue;
  const sources = [...E].filter((p) => files.has(p) && /\.(m?[jt]sx?|json)$/.test(p));
  let anyNamed = false;
  for (const x of X) {
    pairs++;
    const s = stem(x);
    if (s === "package" || s === "index") { unnamed++; continue; }
    const hit = sources.find((p) => read(p).includes(s));
    if (hit) { named++; anyNamed = true; if (sample.length < 15) sample.push({ file: f.path, x, namedIn: hit }); }
    else unnamed++;
  }
  (anyNamed ? filesWithNamed : filesAllUnnamed).add(`${f.project}:${f.path}`);
}
console.log({ pairs, named, unnamed, filesWithANamedExtra: filesWithNamed.size, filesAllExtrasUnnamed: filesAllUnnamed.size });
for (const s of sample) console.log(JSON.stringify(s));
