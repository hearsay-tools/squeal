// Throwaway (026 agent37-sandboxes). Checks the OS features Squeal leans on, in a directory
// given as argv[2] (default: the home): nice, process groups, SQLite WAL across two
// processes, commit cost, fs.watch latency, realpath. One JSON line per check.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync, watch, rmSync, mkdirSync } from "node:fs";
import { getPriority, setPriority, homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = mkdtempSync(join(process.argv[2] ?? homedir(), "sq026-compat-"));
const out = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// nice
{
  const c = spawn("sleep", ["5"]);
  let r;
  try { setPriority(c.pid, 10); r = getPriority(c.pid); } catch (e) { r = String(e.code ?? e); }
  let shell;
  try { shell = execFileSync("sh", ["-c", "nice -n 10 sh -c 'cat /proc/self/stat'"]).toString().split(" ")[18]; } catch (e) { shell = String(e); }
  c.kill();
  out({ check: "nice", setPriorityReadBack: r, niceCommandNiceField: shell });
}
// process group kill
{
  const c = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], { detached: true });
  const grand = await new Promise((r) => c.stdout.once("data", (d) => r(Number(String(d).trim()))));
  process.kill(-c.pid, "SIGTERM");
  await sleep(300);
  out({ check: "process-group", parentAlive: alive(c.pid), grandchildAlive: alive(grand) });
}
// SQLite WAL, two processes, commit cost
{
  const f = join(base, "t.sqlite");
  const db = new DatabaseSync(f);
  const mode = db.prepare("PRAGMA journal_mode=WAL").get();
  db.exec("CREATE TABLE t(k INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT INTO t(v) VALUES (?)");
  const cost = {};
  for (const sync of ["NORMAL", "FULL"]) {
    db.exec(`PRAGMA synchronous=${sync}`);
    const t = performance.now();
    for (let i = 0; i < 200; i++) ins.run("x".repeat(100));
    cost[sync] = Math.round((performance.now() - t) / 200 * 100) / 100;
  }
  // A second process writes 200 rows while this one reads with busy_timeout.
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(${JSON.stringify(f)}); d.exec("PRAGMA busy_timeout=5000");
    const s = d.prepare("INSERT INTO t(v) VALUES ('y')");
    for (let i = 0; i < 200; i++) s.run();
  `]);
  let reads = 0, errors = 0;
  db.exec("PRAGMA busy_timeout=5000");
  const done = new Promise((r) => child.on("exit", r));
  let exited = false; done.then(() => { exited = true; });
  while (!exited) { try { db.prepare("SELECT count(*) c FROM t").get(); reads++; } catch { errors++; } await sleep(1); }
  const code = await done;
  const rows = db.prepare("SELECT count(*) c FROM t").get().c;
  db.close();
  out({ check: "sqlite-wal", journalMode: mode.journal_mode, msPerCommit: cost, otherProcessExit: code, rows, readsDuring: reads, readErrors: errors });
}
// fs.watch latency: own writes, 5 tries, directory and recursive
for (const recursive of [false, true]) {
  const dir = join(base, `w${recursive ? "r" : ""}`);
  mkdirSync(join(dir, "sub"), { recursive: true });
  const lat = [];
  let w;
  try {
    for (let i = 0; i < 5; i++) {
      const target = recursive ? join(dir, "sub", `f${i}`) : join(dir, `f${i}`);
      const got = new Promise((r) => {
        w = watch(dir, { recursive }, () => r(true));
        setTimeout(() => r(false), 3000);
      });
      const t = performance.now();
      writeFileSync(target, "x");
      const ok = await got;
      lat.push(ok ? Math.round((performance.now() - t) * 10) / 10 : "none in 3 s");
      w.close();
    }
    out({ check: recursive ? "fs.watch-recursive" : "fs.watch", latenciesMs: lat });
  } catch (e) { out({ check: recursive ? "fs.watch-recursive" : "fs.watch", error: String(e.code ?? e) }); }
}
// realpath through a symlink chain
{
  mkdirSync(join(base, "real"));
  writeFileSync(join(base, "real", "f"), "x");
  symlinkSync(join(base, "real"), join(base, "l1"));
  symlinkSync(join(base, "l1"), join(base, "l2"));
  const p = join(base, "l2", "f");
  out({ check: "realpath", js: realpathSync(p) === realpathSync(join(base, "real", "f")), native: realpathSync.native(p) === realpathSync(join(base, "real", "f")) });
}
rmSync(base, { recursive: true, force: true });
