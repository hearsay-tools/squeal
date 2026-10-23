import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/tmp/ms152/an/c/store.sqlite", { readOnly: true });
const cands = new Set(["-", ...db.prepare("SELECT hash FROM file_hashes WHERE path='.git'").all().map((r) => r.hash)]);
const key = (d, segs) => createHash("sha256").update(JSON.stringify(["squeal-check-key/2", d.envHash, d.testFile.project, d.testFile.path, d.dependencies])).update("\0").update(segs.join("")).digest("hex");
const all = new Map(db.prepare("SELECT worktree_id w, path, key FROM test_file_keys").all().map((r) => [r.w + r.path, r.key]));
const wts = db.prepare("SELECT DISTINCT worktree_id w FROM test_file_keys").all().map((r) => r.w);
const seen = new Set();
for (const l of readFileSync("/tmp/ms152/an/key-dump.jsonl", "utf8").trim().split("\n")) {
  const d = JSON.parse(l); if (!/departure|drain\.test|eval-root/.test(d.testFile.path)) continue;
  for (const h of [...cands, null]) {
    const segs = h === null ? d.segments.filter((s) => !s.startsWith(".git\0")) : d.segments.map((s) => (s.startsWith(".git\0") ? `.git\0${h}\0` : s));
    const k = key(d, segs); const hit = wts.filter((w) => all.get(w + d.testFile.path) === k);
    if (hit.length && !seen.has(d.testFile.path + k)) { seen.add(d.testFile.path + k); console.log(d.testFile.path, "env", d.envHash.slice(0, 8), ".git as", h === null ? "absent from list" : h.slice(0, 8), "= key of worktrees", hit.join(",")); }
  }
}
console.log("done");
