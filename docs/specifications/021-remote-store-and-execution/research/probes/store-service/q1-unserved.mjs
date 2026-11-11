// Throwaway (021-01). What the git-ref route leaves unserved, counted on a COPY of a store.
// node q1-unserved.mjs <store copy> <repo with origin/main> <days>
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const [storePath, repo, daysArg] = process.argv.slice(2);
const days = Number(daysArg ?? 7);
const db = new DatabaseSync(storePath);
const now = Number(db.prepare("select max(recorded_at) m from results where worktree_id not like 'import:%'").get().m);
const since = now - days * 86400e3;
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const main = new Map(git("log", "--first-parent", "--format=%H %ct", "origin/main").trim().split("\n").map((l) => { const [h, t] = l.split(" "); return [h, Number(t) * 1000]; }));
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "n/a");
console.log(`store ${storePath}; window ${days} d to ${new Date(now).toISOString()}; main commits known: ${main.size}`);

// A. Local results in the window by the commit they were recorded at.
const cls = { main_clean: [0, 0, 0], main_dirty: [0, 0, 0], branch_clean: [0, 0, 0], branch_dirty: [0, 0, 0], no_commit: [0, 0, 0] };
const fails = { main_clean: 0, other: 0 };
for (const r of db.prepare("select commit_sha c, dirty d, outcome o, duration_ms ms from results where recorded_at >= ? and worktree_id not like 'import:%'").iterate(since)) {
  const k = r.c == null ? "no_commit" : (main.has(r.c) ? "main" : "branch") + (r.d ? "_dirty" : "_clean");
  const k2 = r.c == null ? "no_commit" : k;
  cls[k2][0]++; cls[k2][1] += r.ms; if (r.o === "fail") cls[k2][2]++;
  if (r.o === "fail") fails[k2 === "main_clean" ? "main_clean" : "other"]++;
}
const total = Object.values(cls).reduce((a, v) => a + v[0], 0);
const totalMs = Object.values(cls).reduce((a, v) => a + v[1], 0);
console.log("\nA. local results recorded in the window, by commit class (rows = check results; one row per check and key)");
for (const [k, [n, ms, f]] of Object.entries(cls)) console.log(`  ${k.padEnd(13)} rows ${String(n).padStart(9)} (${pct(n, total)})  check-seconds ${(ms / 1000).toFixed(0).padStart(8)} (${pct(ms, totalMs)})  fails ${f}`);
console.log(`  fails total ${fails.main_clean + fails.other}; at clean main commits ${fails.main_clean}`);

// B. Current inherited states: did the origin worktree run them at a main commit or elsewhere?
const inh = { main: 0, branch: 0, none: 0 };
const own = db.prepare("select count(*) n from known_states where validity='current' and origin_kind='own'").get().n;
for (const r of db.prepare("select origin_commit c from known_states where validity='current' and origin_kind='inherited'").iterate()) inh[r.c == null ? "none" : main.has(r.c) ? "main" : "branch"]++;
const inhTotal = inh.main + inh.branch + inh.none;
console.log(`\nB. current known states (all worktrees): own ${own}, inherited ${inhTotal} (${pct(inhTotal, inhTotal + own)})`);
console.log(`  inherited from a run at a main commit ${inh.main} (${pct(inh.main, inhTotal)}), at a branch commit ${inh.branch} (${pct(inh.branch, inhTotal)}), no commit ${inh.none}`);

// C. Imports (018 D14), when present: landing -> export -> import, and live keys served.
const hasImports = db.prepare("select count(*) n from sqlite_master where name='imports'").get().n > 0;
if (hasImports) {
  console.log("\nC. imports: commit, landed (committer time), export created, imported; minutes after landing");
  const rows = db.prepare("select header h, imported_at i from imports order by imported_at").all();
  const lag = [];
  for (const r of rows) {
    const h = JSON.parse(r.h); const landed = main.get(h.commit);
    const m = (x) => (landed ? ((x - landed) / 60e3).toFixed(1) : "?");
    lag.push(landed ? (r.i - landed) / 60e3 : null);
    console.log(`  ${h.commit.slice(0, 8)} landed ${landed ? new Date(landed).toISOString().slice(11, 19) : "not on main"} export +${m(h.createdAt)} min, first import +${m(r.i)} min`);
  }
  const first = Math.min(...rows.map((r) => Number(r.i)));
  const landedSince = [...main.values()].filter((t) => t >= first - 86400e3 && t <= now).length;
  console.log(`  main commits landed from 24 h before the first import to the window end: ${landedSince}; imports ${rows.length}`);
  const live = db.prepare("select count(*) n from known_states where origin_worktree like 'import:%'").get().n;
  const keys = db.prepare("with ik as (select distinct key from results where worktree_id like 'import:%') select count(*) n from test_file_keys t join ik on ik.key = t.key").get().n;
  const envs = db.prepare("select json_extract(e.descriptor,'$.nodeVersion') v, count(distinct w.worktree_id) n from worktree_environment_hashes w join environments e on e.hash=w.hash group by 1").all();
  console.log(`  known states with an imported origin now: ${live}; worktree keys equal to an imported key: ${keys}; worktree environments by Node: ${JSON.stringify(envs)}`);
}
