// Throwaway (row 021-03). Names who holds a SQLite WAL database's write lock,
// without opening the database: SQLite's unix VFS takes the WAL write lock as
// a POSIX lock on byte 120 of the -shm file (UNIX_SHM_BASE = (22+8)*4, lock 0),
// and /proc/locks lists POSIX locks with the owning pid. Polls every INTERVAL
// ms and prints one JSON line per write-lock hold: holder pid, its command
// line, how long it held the lock (to the polling resolution), WAL frames
// added (mxFrame delta; negative when the WAL restarted). One "hold" is every
// poll that saw the same pid: back-to-back transactions of one process merge.
// Usage: node lock-watch.mjs <seconds> <interval ms> <db path>...
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
const [secs, interval, ...dbs] = process.argv.slice(2);
const stores = dbs.map((db) => {
  const st = statSync(`${db}-shm`);
  return { db, ino: String(st.ino), holder: null, since: 0, wal0: 0, polls: 0, waiters: 0 };
});
// The wal-index header in the -shm file: mxFrame, the last valid WAL frame, is
// the u32 at byte 16 (native byte order). Read with plain file I/O, no lock.
const walSize = (db) => { try { const fd = openSync(`${db}-shm`, "r"); const b = Buffer.alloc(4); readSync(fd, b, 0, 4, 16); closeSync(fd); return b.readUInt32LE(0); } catch { return 0; } };
const cmd = (pid) => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter((s) => s && s.length < 200).join(" ").replace(/\/home\/agent\/[^ ]*\/(dist\/cli\/)?/g, "").slice(0, 160); }
  catch { return "(gone)"; }
};
const cmds = new Map();
const end = Date.now() + Number(secs) * 1000;
const emit = (s, now) => {
  const ms = now - s.since;
  console.log(JSON.stringify({ db: s.db.replace(/^.*\/projects\//, ""), at: new Date(s.since).toISOString(), ms, pid: s.holder, cmd: cmds.get(s.holder), frames: walSize(s.db) - s.wal0, polls: s.polls, waitersSeen: s.waiters, load: readFileSync("/proc/loadavg", "utf8").split(" ")[0] }));
};
const timer = setInterval(() => {
  const now = Date.now();
  const text = readFileSync("/proc/locks", "utf8");
  for (const s of stores) {
    let writer = null, waiters = 0;
    for (const line of text.split("\n")) {
      if (!line.includes(`:${s.ino} `)) continue;
      const f = line.trim().split(/\s+/);
      const blocked = f[1] === "->";
      const o = blocked ? 1 : 0;
      const [type, pid, start] = [f[3 + o], f[4 + o], f[6 + o]];
      if (start !== "120") continue;
      if (blocked) waiters++;
      else if (type === "WRITE") writer = pid;
    }
    if (writer !== s.holder) {
      if (s.holder !== null) emit(s, now);
      s.holder = writer; s.since = now; s.wal0 = walSize(s.db); s.polls = 0; s.waiters = 0;
      if (writer !== null && !cmds.has(writer)) cmds.set(writer, cmd(writer));
    }
    if (writer !== null) { s.polls++; s.waiters = Math.max(s.waiters, waiters); }
  }
  if (now > end) { clearInterval(timer); for (const s of stores) if (s.holder !== null) emit(s, Date.now()); }
}, Number(interval));
