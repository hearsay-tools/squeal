// 011-223 probe: per live worktree registered in the window, the first start's timeline from a store copy.
// hook (earliest liveness-told startingSince) -> daemon constructed (worktrees.registered_at)
// -> first baseline checkpoint (the listing and lookup are done) -> first delivery after it (feed-delivered is the latest only).
// usage: node starts.mjs <store copy> <copy epoch ms> [hours=72]
import { DatabaseSync } from "node:sqlite";
const [file, copyMs, hours = "72"] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const since = Number(copyMs) - Number(hours) * 3600_000;
const meta = (key) => db.prepare("select value from meta where key = ?").get(key)?.value ?? null;
const out = [];
for (const w of db.prepare("select id, root, registered_at from worktrees where registered_at > ? order by registered_at").all(since)) {
  const told = JSON.parse(meta(`liveness-told:${w.id}`) ?? "{}");
  const starting = Object.values(told).map((v) => v?.startingSince).filter((v) => typeof v === "number");
  const hook = starting.length ? Math.min(...starting) : null;
  const cp = db.prepare("select started_at, revision, json_array_length(test_files) n, end_state from checkpoints where worktree_id = ? and kind = 'baseline' order by started_at limit 1").get(w.id);
  const keys = db.prepare("select count(*) n from test_file_keys where worktree_id = ?").get(w.id).n;
  const row = {
    wt: w.id.slice(0, 8), dir: w.root.split("/").pop().slice(0, 8),
    at: new Date(w.registered_at).toISOString().slice(5, 19),
    hookToDaemonS: hook === null || hook > w.registered_at ? null : (w.registered_at - hook) / 1000,
    daemonToListedS: cp ? (cp.started_at - w.registered_at) / 1000 : null,
    misses: cp?.n ?? null, keys, end: cp?.end_state ?? null,
  };
  out.push(row);
  console.log(JSON.stringify(row));
}
const q = (xs, p) => { const s = xs.filter((x) => x !== null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
for (const k of ["hookToDaemonS", "daemonToListedS"]) {
  const xs = out.map((r) => r[k]).filter((x) => x !== null);
  console.log(`${k}: n=${xs.length} min=${q(xs, 0)} median=${q(xs, 0.5)} p90=${q(xs, 0.9)} max=${q(xs, 1)}`);
}
// Every current daemon (first start or restart): its earliest consumer registered in the 120 s before it was
// constructed. A hook registers its consumer as it spawns the daemon, so the gap is hook -> daemon constructed.
const gaps = db.prepare(`select substr(w.id,1,8) wt, (w.daemon_started_at - min(c.registered_at))/1000.0 gapS
  from worktrees w join consumers c on c.worktree_id = w.id
  where w.daemon_started_at is not null and c.registered_at between w.daemon_started_at - 120000 and w.daemon_started_at
  group by w.id order by gapS`).all();
console.log(`hook (consumer registered) -> daemon constructed, current daemons: ${gaps.map((g) => `${g.wt} ${g.gapS}`).join(", ")}`);
