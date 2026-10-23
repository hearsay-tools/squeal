// For the misses content.mjs put in "equal content stored before, different key": clone keys (same observed set now) against the stored keys of both sides.
import { readFileSync } from "node:fs"; import { DatabaseSync } from "node:sqlite";
const [, , contentPath, missW, priorW, aStore, aRoot, bStore, bRoot] = process.argv;
const rows = readFileSync(contentPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => o.cls === "equal content stored before, different key" && o.w === missW);
const A = new DatabaseSync(aStore, { readOnly: true }), Bd = new DatabaseSync(bStore, { readOnly: true });
const wid = (db, root) => db.prepare("SELECT id FROM worktrees WHERE root=?").get(root).id;
const ka = new Map(A.prepare("SELECT path, key FROM test_file_keys WHERE worktree_id=?").all(wid(A, aRoot)).map((r) => [r.path, r.key]));
const kb = new Map(Bd.prepare("SELECT path, key FROM test_file_keys WHERE worktree_id=?").all(wid(Bd, bRoot)).map((r) => [r.path, r.key]));
const t = {}; const add = (k, s) => { t[k] ??= [0, 0]; t[k][0]++; t[k][1] += s; };
for (const o of rows) {
  const p = o.file.split("\0")[1]; const prior = o.equalContent.filter((e) => e.w === priorW).at(-1); if (!prior) continue;
  const a = ka.get(p), b = kb.get(p);
  add(`clone keys ${a === b ? "equal" : "differ"}; clone at the miss's commit ${b === o.key ? "=" : "≠"} the miss's stored key; clone at the earlier commit ${a === prior.key ? "=" : "≠"} the earlier stored key`, o.secs ?? 0);
}
for (const [k, [n, s]] of Object.entries(t)) console.log(`${n} files, ${Math.round(s)} s: ${k}`);
