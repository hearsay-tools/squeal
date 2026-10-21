// Throwaway probe P2 (014-01): read-only discovery on the live host. Never
// connects to a socket, never opens a store for writing, never signals.
// Sources: the socket directories (stat), `ss -xlpe` (UNIX_DIAG: vfs inode and
// pid), /proc/<pid>/{cmdline,stat,cwd} for `squeal.mjs daemon`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const uid = process.getuid();
const t0 = performance.now();
const dirs = [process.env.XDG_RUNTIME_DIR, `/tmp/squeal-${uid}`].filter(Boolean);
const sockets = [];
for (const dir of dirs) {
  let names = [];
  try { names = readdirSync(dir); } catch { continue; }
  for (const n of names) {
    const m = /^squeal-([0-9a-f]{16})\.sock$/.exec(n);
    if (!m) continue;
    const s = statSync(join(dir, n));
    sockets.push({ path: join(dir, n), id: m[1], ino: s.ino, mtime: new Date(s.mtimeMs).toISOString() });
  }
}
const tDirs = performance.now();
const ss = execFileSync("ss", ["-xlpe"], { encoding: "utf8" });
const byVfsIno = new Map();
for (const line of ss.split("\n")) {
  const ino = / ino:(\d+) /.exec(line);
  const pid = /pid=(\d+)/.exec(line);
  if (ino) byVfsIno.set(Number(ino[1]), pid ? Number(pid[1]) : null);
}
const tSs = performance.now();
const daemons = new Map();
const hz = 100;
const btime = Number(/btime (\d+)/.exec(readFileSync("/proc/stat", "utf8"))[1]);
for (const p of readdirSync("/proc")) {
  if (!/^\d+$/.test(p)) continue;
  let argv;
  try { argv = readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0"); } catch { continue; }
  const i = argv.findIndex((a) => /squeal(\.mjs)?$|squeal\/dist\/cli\/squeal\.mjs$|cli\/squeal\.mjs$/.test(a));
  if (i < 0 || argv[i + 1] !== "daemon") continue;
  const root = argv[i + 2];
  let id = null, rootExists = existsSync(root);
  try { id = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16); } catch {}
  const stat = readFileSync(`/proc/${p}/stat`, "utf8");
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const startedAt = new Date((btime + Number(f[19]) / hz) * 1000).toISOString();
  let cwd = null; try { cwd = readlinkSync(`/proc/${p}/cwd`); } catch {}
  const ver = /\/squeal\/([^/]+)\/dist\/cli\/squeal\.mjs$/.exec(argv[i]);
  const cache = argv[i].includes("/.codex/") ? "codex" : argv[i].includes("/.claude/") ? "claude" : "other";
  daemons.set(Number(p), { pid: Number(p), root, rootExists, id, startedAt, cwd, version: ver?.[1] ?? null, cache,
    awaitLock: argv.includes("--await-lock"), nice: Number(f[16]) });
}
const tProc = performance.now();
const tied = sockets.map((s) => ({ ...s, pid: byVfsIno.has(s.ino) ? byVfsIno.get(s.ino) : null, listening: byVfsIno.has(s.ino) }));
const out = {
  load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0],
  ms: { dirs: +(tDirs - t0).toFixed(1), ss: +(tSs - tDirs).toFixed(1), procScan: +(tProc - tSs).toFixed(1) },
  sockets: tied.length, listening: tied.filter((s) => s.listening).length, daemons: daemons.size,
  staleSockets: tied.filter((s) => !s.listening),
  socketIdMatchesCmdlineHash: tied.filter((s) => s.pid !== null).map((s) => daemons.get(s.pid)?.id === s.id),
  daemonsWithoutSocket: [...daemons.values()].filter((d) => !tied.some((s) => s.pid === d.pid)).map((d) => ({ pid: d.pid, root: d.root, version: d.version })),
  sample: [...daemons.values()].slice(0, 3),
  versions: [...daemons.values()].reduce((a, d) => ((a[`${d.cache}@${d.version}`] = (a[`${d.cache}@${d.version}`] ?? 0) + 1), a), {}),
  rootsMissing: [...daemons.values()].filter((d) => !d.rootExists).length,
};
console.log(JSON.stringify(out, null, 1).replaceAll(process.env.HOME, "~"));
