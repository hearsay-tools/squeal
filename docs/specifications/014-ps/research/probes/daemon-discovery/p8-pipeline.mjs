// Throwaway probe P8 (014-01): the recommended discovery pipeline end to end,
// read-only, on the live host. 1. /proc scan for `<squeal script> daemon <root>`
// processes; 2. per pid, /proc/<pid>/fd names the lock file, and so the store
// and the worktree id; 3. /proc/locks says whether the pid holds that lock;
// 4. `ss -xle` (no -p) gives each listening socket's vfs inode and socket
// inode, tied to a pid through its fds; 5. a read-only store connection gives
// the row, compared with /proc start time. Plus stale socket files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join } from "node:path";

const T = [performance.now()];
const mark = () => T.push(performance.now());
const btime = Number(/btime (\d+)/.exec(readFileSync("/proc/stat", "utf8"))[1]);
const SCRIPT = /(^|\/)(squeal|squeal\.mjs|squeal\/dist\/cli\/index\.js)$/;
// 1
const daemons = [];
for (const p of readdirSync("/proc")) {
  if (!/^\d+$/.test(p)) continue;
  let argv; try { argv = readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0"); } catch { continue; }
  const i = argv.findIndex((a, k) => k > 0 && argv[k - 1] && SCRIPT.test(argv[k - 1]) && a === "daemon");
  if (i < 0) continue;
  const st = readFileSync(`/proc/${p}/stat`, "utf8"); const f = st.slice(st.lastIndexOf(")") + 2).split(" ");
  daemons.push({ pid: Number(p), script: argv[i - 1], root: argv[i + 1], awaitLock: argv.includes("--await-lock"),
    startedAt: Math.round((btime + Number(f[19]) / 100) * 1000), state: f[0] });
}
mark();
// 2
const sockInos = new Map();
for (const d of daemons) {
  for (const fd of readdirSync(`/proc/${d.pid}/fd`)) {
    let l; try { l = readlinkSync(`/proc/${d.pid}/fd/${fd}`); } catch { continue; }
    const m = /^(.*)\/squeal\/locks\/([0-9a-f]{16})\.sqlite$/.exec(l);
    if (m) { d.commonDir = m[1]; d.id = m[2]; d.lockPath = l; }
    const s = /^socket:\[(\d+)\]$/.exec(l); if (s) sockInos.set(Number(s[1]), d.pid);
  }
  if (!d.id) { try { d.id = createHash("sha256").update(realpathSync(d.root)).digest("hex").slice(0, 16); d.idFrom = "cmdline"; } catch { d.idFrom = "none"; } }
  else d.idFrom = "lock fd";
}
mark();
// 3
const held = new Map();
for (const line of readFileSync("/proc/locks", "utf8").split("\n")) {
  const m = /^\d+: POSIX\s+\w+\s+WRITE\s+(\d+) [0-9a-f]+:[0-9a-f]+:(\d+) /.exec(line);
  if (m) held.set(`${m[1]}:${m[2]}`, true);
}
for (const d of daemons) d.holdsLock = d.lockPath ? held.has(`${d.pid}:${statSync(d.lockPath).ino}`) : false;
mark();
// 4
const listeners = new Map(); // vfs inode -> pid
for (const line of execFileSync("ss", ["-xle"], { encoding: "utf8" }).split("\n")) {
  const m = /\s(\d+)\s+\*\s+\d+.*\bino:(\d+)\b/.exec(line);
  if (m) listeners.set(Number(m[2]), sockInos.get(Number(m[1])) ?? null);
}
const socketFiles = [];
for (const dir of [process.env.XDG_RUNTIME_DIR, `/tmp/squeal-${process.getuid()}`]) {
  let names = []; try { names = readdirSync(dir); } catch { continue; }
  for (const n of names) if (/^squeal-[0-9a-f]{16}\.sock$/.test(n)) {
    const path = join(dir, n); socketFiles.push({ path, id: n.slice(7, 23), pid: listeners.get(statSync(path).ino) });
  }
}
for (const d of daemons) d.socket = socketFiles.find((s) => s.pid === d.pid)?.path ?? null;
mark();
// 5
const stores = new Map();
for (const d of daemons) {
  if (!d.commonDir) continue;
  if (!stores.has(d.commonDir)) {
    const db = new DatabaseSync(join(d.commonDir, "squeal", "store.sqlite"), { readOnly: true });
    db.exec("PRAGMA busy_timeout = 100");
    stores.set(d.commonDir, db);
  }
  const w = stores.get(d.commonDir).prepare("SELECT root, daemon_started_at s, daemon_version v, daemon_socket k FROM worktrees WHERE id = ?").get(d.id);
  d.row = w ? { rootMatches: w.root === d.root, startDiffMs: w.s == null ? null : w.s - d.startedAt, version: w.v, recorded: w.k !== null } : null;
  const gitFile = join(d.root, ".git");
  d.rootExists = existsSync(d.root);
  try { const g = /^gitdir: (.*)$/m.exec(readFileSync(gitFile, "utf8")); d.adminDirExists = g ? existsSync(g[1]) : "main"; } catch { d.adminDirExists = d.rootExists ? "main" : false; }
}
for (const db of stores.values()) db.close();
mark();
const out = {
  load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0],
  ms: ["procScan", "fds", "procLocks", "ss+socketFiles", "stores"].map((k, i) => `${k} ${(T[i + 1] - T[i]).toFixed(1)}`),
  daemons: daemons.length, lockHolders: daemons.filter((d) => d.holdsLock).length,
  withSocket: daemons.filter((d) => d.socket).length,
  notHolding: daemons.filter((d) => !d.holdsLock).map((d) => ({ pid: d.pid, awaitLock: d.awaitLock, state: d.state })),
  rowsMatched: daemons.filter((d) => d.row?.rootMatches).length,
  startDiffMs: daemons.map((d) => d.row?.startDiffMs).filter((x) => x != null).sort((a, b) => a - b),
  idFromLockFdEqualsCmdlineHash: daemons.every((d) => { try { return d.id === createHash("sha256").update(realpathSync(d.root)).digest("hex").slice(0, 16); } catch { return false; } }),
  versionPathVsRow: daemons.filter((d) => d.row && !d.script.includes(`/${d.row.version}/`)).length,
  staleSocketFiles: socketFiles.filter((s) => s.pid === undefined).map((s) => basename(s.path)),
  rootsGone: daemons.filter((d) => !d.rootExists).length, adminDirsGone: daemons.filter((d) => d.adminDirExists === false).length,
};
console.log(JSON.stringify(out, null, 1));
