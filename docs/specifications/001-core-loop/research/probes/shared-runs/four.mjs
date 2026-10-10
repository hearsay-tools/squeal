// PROBE 001-201 (throwaway): four worktrees of one repository start their daemons together;
// wall time until every worktree's baseline checkpoint ended, CPU per daemon, files run.
import { spawn } from "node:child_process";
import { rmSync, openSync, readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [squeal, arm, backlog, ...roots] = process.argv.slice(2);
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// No policy file (cezar's own is untracked, so a clone has none): Squeal's defaults. With `backlog` a number,
// a policy setting only runner.backlogTierSize, identical in every worktree.
for (const root of roots) {
  rmSync(`${root}/squeal.config.json`, { force: true });
  if (backlog !== "-") {
    writeFileSync(`${root}/squeal.config.json`, JSON.stringify({ runner: { backlogTierSize: Number(backlog) } }, null, 2) + "\n");
  }
}
const store = `${roots[0]}/.git/squeal/store.sqlite`;
rmSync(`${roots[0]}/.git/squeal`, { recursive: true, force: true });
// As env -i with HOME, PATH, USER, LANG: no CEZ_*, CLAUDE*, CODEX*, ANTHROPIC* or SQUEAL* variable reaches a daemon.
const env = { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER, LANG: process.env.LANG ?? "C.UTF-8" };
if (arm.startsWith("proto")) env.SQUEAL_PROBE_CLAIMS = "1";
const t0 = Date.now();
const kids = roots.map((root, i) => {
  const out = openSync(`/tmp/sr201/probe/${arm}-${i}.log`, "w");
  const child = spawn("/usr/bin/time", ["-f", "TIME %e %U %S %M", "nice", "-n", "5", "node", squeal, "daemon", root],
    { env, stdio: ["ignore", out, out] });
  return { root, child, exited: new Promise((r) => child.on("exit", r)) };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = null;
while (Date.now() - t0 < 30 * 60_000) {
  await sleep(2000);
  if (!existsSync(store)) continue;
  let db;
  try {
    db = new DatabaseSync(store, { readOnly: true });
    db.exec("PRAGMA busy_timeout=5000");
    const rows = db.prepare(`SELECT w.root, (SELECT end_state FROM checkpoints c WHERE c.worktree_id=w.id AND c.kind='baseline' ORDER BY started_at DESC LIMIT 1) base,
      (SELECT count(*) FROM test_file_keys k WHERE k.worktree_id=w.id) files,
      (SELECT count(*) FROM test_file_keys k WHERE k.worktree_id=w.id AND k.pending IS NOT NULL) pending,
      (SELECT count(*) FROM known_states s WHERE s.worktree_id=w.id AND s.validity='current') current
      FROM worktrees w`).all();
    const line = rows.map((r) => `${r.root.split("/").pop()}:${r.base ?? "-"}/${r.files}f/${r.pending}p/${r.current}c`).join(" ");
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${line}`);
    if (rows.length === roots.length && rows.every((r) => r.base !== null && r.base !== "open" && r.files > 0 && r.pending === 0)) { done = Date.now() - t0; break; }
  } catch (e) { console.log("poll error", String(e)); } finally { db?.close(); }
}
console.log(`ARM ${arm} wall ${done === null ? "timeout" : (done / 1000).toFixed(1) + " s"}`);
// `time` execs nothing itself: its child is `nice`, which execs node, so the daemon is time's direct child.
// SIGTERM goes to the daemon (D10: it ends its tier, closes the runner, reaps its workers), so `time`
// reports the CPU of the daemon and every worker it reaped. SIGKILL to the whole tree after 60 s.
const childOf = (pid) => readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
const tree = (pid) => { const out = [pid]; try { for (const c of childOf(pid)) out.push(...tree(c)); } catch {} return out; };
const daemons = kids.map((k) => { try { return childOf(k.child.pid)[0]; } catch { return undefined; } });
const everything = kids.flatMap((k) => tree(k.child.pid));
for (const pid of daemons) if (pid !== undefined) try { process.kill(pid, "SIGTERM"); } catch {}
const hard = setTimeout(() => { for (const pid of everything) try { process.kill(pid, "SIGKILL"); } catch {} }, 60_000);
await Promise.all(kids.map((k) => k.exited));
clearTimeout(hard);
for (const pid of everything) try { process.kill(pid, "SIGKILL"); console.log(`killed leftover ${pid}`); } catch {}
const load = readFileSync("/proc/loadavg", "utf8").trim();
console.log(`loadavg at end ${load}`);
const db = new DatabaseSync(store, { readOnly: true });
console.table(db.prepare(`SELECT substr(w.root, length(w.root)-3) wt, count(r.id) runs, sum(json_array_length(r.test_files)) files_run,
  round(sum(r.ended_at - r.started_at)/1000.0,1) tier_secs FROM worktrees w LEFT JOIN runs r ON r.worktree_id=w.id GROUP BY w.id`).all());
console.table(db.prepare(`SELECT end_state, count(*) n FROM runs GROUP BY 1`).all());
console.table(db.prepare(`SELECT kind, end_state, count(*) n FROM checkpoints GROUP BY 1,2`).all());
console.table(db.prepare(`SELECT outcome, count(*) n FROM results GROUP BY 1`).all());
let cpu = 0;
roots.forEach((root, i) => {
  const log = readFileSync(`/tmp/sr201/probe/${arm}-${i}.log`, "utf8");
  const m = log.match(/TIME (\S+) (\S+) (\S+) (\S+)/);
  if (m) { cpu += Number(m[2]) + Number(m[3]); console.log(`${root}: wall ${m[1]} user ${m[2]} sys ${m[3]} maxrss ${m[4]}KB`); }
});
console.log(`ARM ${arm} total CPU ${cpu.toFixed(1)} s`);
db.exec(`VACUUM INTO '/tmp/sr201/probe/store-${arm}.sqlite'`);
