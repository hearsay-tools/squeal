// Row 015-114 round 2: sample a scratch daemon's re-walk once a second.
// Usage: node sample.mjs <store.sqlite> <clone root> <out.jsonl> [max seconds]
// Each line: seconds since start, 1-minute load, CPU seconds of the daemon's
// process tree (utime+stime+cutime+cstime of the daemon, whose cwd is the
// store's folder, and of its live descendants), keyed and pending test files,
// a digest of the worktree's keys (each new key list is saved beside out), stored walks at current keys, the re-walk
// marker, and the worktree's runs and results (a test run would show there).
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const [storePath, root, out, maxArg] = process.argv.slice(2);
const storeDir = dirname(storePath);
const max = Number(maxArg ?? 900);
const t0 = Date.now();
function procs() {
  const all = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, "utf8");
      const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      let cwd = null;
      try { cwd = readlinkSync(`/proc/${d}/cwd`); } catch {}
      all.set(Number(d), { ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]), cwd });
    } catch {}
  }
  return all;
}
// The daemon chdirs while it walks, so a pid seen once with the store's folder as cwd is kept.
const known = new Set();
function treeCpu() {
  const all = procs();
  for (const [pid, p] of all) if (p.cwd === storeDir) known.add(pid);
  const daemons = [...known].filter((pid) => all.has(pid));
  const roots = daemons.filter((pid) => !daemons.includes(all.get(pid).ppid));
  let ticks = 0, n = 0;
  const seen = new Set();
  const todo = [...roots];
  while (todo.length) {
    const pid = todo.pop();
    if (seen.has(pid)) continue;
    seen.add(pid); n++;
    ticks += all.get(pid)?.ticks ?? 0;
    for (const [c, p] of all) if (p.ppid === pid) todo.push(c);
  }
  return { cpu: ticks / 100, procs: n, daemon: roots[0] ?? null };
}
let stableMarker = 0;
let lastDigest = null;
for (;;) {
  const at = (Date.now() - t0) / 1000;
  const load = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  const tree = treeCpu();
  const row = { at: Math.round(at * 10) / 10, load, ...tree };
  try {
    const db = new DatabaseSync(storePath, { readOnly: true });
    const wt = db.prepare("select id from worktrees where root = ?").get(root)?.id;
    if (wt) {
      const keys = db.prepare("select project, path, key, pending from test_file_keys where worktree_id = ? order by project, path").all(wt);
      row.listed = keys.length;
      row.keyed = keys.filter((k) => k.key !== null).length;
      row.pending = keys.filter((k) => k.pending !== null).length;
      const text = keys.map((k) => `${k.project}|${k.path}|${k.key}`).join("\n");
      row.digest = createHash("sha1").update(text).digest("hex").slice(0, 12);
      if (row.digest !== lastDigest) writeFileSync(`${out}.keys-${row.digest}.txt`, text), (lastDigest = row.digest);
      const has = db.prepare("select name from sqlite_master where name = 'test_file_imports'").get();
      row.walks = has ? db.prepare("select count(*) n from test_file_keys k join test_file_imports i on i.project = k.project and i.path = k.path and i.key = k.key where k.worktree_id = ?").get(wt).n : 0;
      row.marker = db.prepare("select value from meta where key = ?").get(`import-rewalk:${wt}`)?.value ?? null;
      row.runs = db.prepare("select count(*) n from runs where worktree_id = ?").get(wt).n;
      row.results = db.prepare("select count(*) n from results where worktree_id = ?").get(wt).n;
    }
    db.close();
  } catch (e) { row.error = String(e.message).slice(0, 80); }
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  stableMarker = row.marker ? stableMarker + 1 : 0;
  if (stableMarker >= 5 || at > max) break;
  await new Promise((r) => setTimeout(r, 1000));
}
