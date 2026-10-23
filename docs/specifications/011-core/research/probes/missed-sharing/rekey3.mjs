// Rebuild host keys from the ORIGINAL stored closure list (store copy before the clone ran) + observed set + host stat-cache hashes.
import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; import { DatabaseSync } from "node:sqlite";
const orig = new DatabaseSync("/tmp/ms152/stores/squeal/store.sqlite", { readOnly: true });
const db = new DatabaseSync("/tmp/ms152/an/c/store.sqlite", { readOnly: true });
const hostW = "c091c53e9fa54061";
const host = new Map(db.prepare("SELECT path, hash FROM file_hashes WHERE worktree_id=?").all(hostW).map((r) => [r.path, r.hash]));
const key = (d, segs) => createHash("sha256").update(JSON.stringify(["squeal-check-key/2", d.envHash, d.testFile.project, d.testFile.path, d.dependencies])).update("\0").update(segs.join("")).digest("hex");
const seen = new Set();
for (const l of readFileSync("/tmp/ms152/an/key-dump.jsonl", "utf8").trim().split("\n")) {
  const d = JSON.parse(l); if (seen.has(d.testFile.path)) continue; seen.add(d.testFile.path);
  const hk = db.prepare("SELECT key FROM test_file_keys WHERE worktree_id=? AND path=?").get(hostW, d.testFile.path)?.key;
  const before = JSON.parse(orig.prepare("SELECT closure_paths FROM test_files WHERE project='' AND path=?").get(d.testFile.path).closure_paths);
  const cloneSet = new Set(d.segments.map((s) => s.split("\0")[0]));
  const added = [...cloneSet].filter((p) => !before.includes(p)), dropped = before.filter((p) => !cloneSet.has(p));
  const clonePart = new Map(d.segments.map((s) => [s.split("\0")[0], s]));
  const segs = before.map((p) => (host.has(p) ? `${p}\0${host.get(p)}\0` : clonePart.get(p) ?? `${p}\0-\0`));
  console.log(d.testFile.path, "stored list", before.length, "clone list", cloneSet.size, "added by clone:", added.slice(0, 6).join(","), "dropped:", dropped.slice(0, 6).join(","), "| rebuilt from stored list = host key:", key(d, segs) === hk);
}
