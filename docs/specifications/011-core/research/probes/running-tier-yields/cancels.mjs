// Cezar runs whose report says the scheduler cancelled them (CANCELLED), with the revision that
// most likely caused it, and the time from that revision to the run's end. Read-only.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r381/cezar-store.sqlite", { readOnly: true });
const runs = db.prepare("select id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at, ended_at, end_state from runs where ended_at is not null").all();
const revs = db.prepare("select number, created_at, changes from revisions where worktree_id=? and created_at between ? and ? order by created_at");
const out = [];
let read = 0;
for (const r of runs) {
  const p = `${r.log_dir}/report.json`;
  if (!existsSync(p)) continue;
  read++;
  let rep; try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch { continue; }
  if (!rep.failure || !/cancel/i.test(rep.failure)) continue;
  const files = JSON.parse(r.test_files);
  const during = revs.all(r.worktree_id, r.started_at, r.ended_at);
  const last = during.at(-1);
  // The first revision during the run that a cancel follows: take the last one before the end.
  out.push({
    id: r.id.slice(0, 8), wt: r.worktree_id.slice(0, 8), n: files.length, completed: rep.completedFiles.length,
    cp: r.checkpoint_id !== null, wallS: (r.ended_at - r.started_at) / 1000, failure: rep.failure.slice(0, 80),
    revsDuring: during.length, sinceFirstRevS: during[0] ? (r.ended_at - during[0].created_at) / 1000 : null,
    sinceLastRevS: last ? (r.ended_at - last.created_at) / 1000 : null, startedAt: new Date(r.started_at).toISOString(),
  });
}
writeFileSync("/tmp/r381/cancels.json", JSON.stringify(out, null, 1));
console.log(`reports read ${read} of ${runs.length}; cancelled ${out.length}`);
const s = out.map((o) => o.sinceLastRevS).filter((x) => x !== null).sort((a, b) => a - b);
const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
console.log(`end minus last revision during the run: n=${s.length} p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${s.at(-1)}`);
for (const o of out.slice(0, 400)) console.log(JSON.stringify(o));
