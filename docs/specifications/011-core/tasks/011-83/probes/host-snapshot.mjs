#!/usr/bin/env node
// 011-83 probe: the live host's capacity, read only. Reads /proc, the pool's
// directory (stat of the permit files, the marks' JSON) and the user config.
// Opens no lock file, no socket, no store; signals nothing.
// Usage: node host-snapshot.mjs [windowSeconds=10] > out.json
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const WINDOW_S = Number(process.argv[2] ?? 10);
const HZ = 100;
const uid = process.getuid();
const poolDir = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`, "squeal");

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

function hostTimes() {
  const line = read("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = line;
  return { user, nice, system, idle, iowait, irq, softirq, steal, total: line.reduce((a, b) => a + b, 0) };
}

function psi() {
  const m = /some avg10=([\d.]+)/.exec(read("/proc/pressure/cpu") ?? "");
  return m ? Number(m[1]) : null;
}

function scan() {
  const procs = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const stat = read(`/proc/${name}/stat`);
    if (stat === null) continue;
    const close = stat.lastIndexOf(")");
    const comm = stat.slice(stat.indexOf("(") + 1, close);
    const f = stat.slice(close + 2).split(" ");
    // f[0] is field 3 (state); field n is f[n - 3].
    procs.set(Number(name), {
      pid: Number(name),
      comm,
      ppid: Number(f[1]),
      utime: Number(f[11]),
      stime: Number(f[12]),
      cutime: Number(f[13]),
      cstime: Number(f[14]),
      nice: Number(f[16]),
      start: Number(f[19]),
    });
  }
  return procs;
}

function cmdline(pid) {
  return (read(`/proc/${pid}/cmdline`) ?? "").split("\0").join(" ").trim();
}

function envOf(pid, names) {
  const text = read(`/proc/${pid}/environ`);
  if (text === null) return {};
  const out = {};
  for (const entry of text.split("\0")) {
    const i = entry.indexOf("=");
    if (i > 0 && names.includes(entry.slice(0, i))) out[entry.slice(0, i)] = entry.slice(i + 1);
  }
  return out;
}

function fileKey(path) {
  const { dev, ino } = statSync(path, { bigint: true });
  const major = ((dev & 0xfff00n) >> 8n) | ((dev & 0xfffff00000000000n) >> 32n);
  const minor = (dev & 0xffn) | ((dev & 0xffffff00000n) >> 12n);
  return `${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${ino}`;
}

function permitHolders() {
  const holders = new Map();
  for (const line of (read("/proc/locks") ?? "").split("\n")) {
    const m = /^\s*\d+:\s+(->\s*)?\S+\s+\S+\s+(READ|WRITE)\s+(-?\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(line);
    if (m === null || m[1] !== undefined || m[2] !== "WRITE") continue;
    const key = `${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")}:${m[6]}`;
    holders.set(key, Number(m[3]));
  }
  const out = [];
  for (const name of readdirSync(poolDir).sort()) {
    if (!/^(pool\.\d+|slow(\.\d+)?)\.lock$/.test(name)) continue;
    const pid = holders.get(fileKey(join(poolDir, name)));
    if (pid !== undefined) out.push({ file: name, pid });
  }
  return out;
}

function marks() {
  const now = Date.now();
  const out = [];
  for (const name of readdirSync(poolDir)) {
    if (!name.startsWith("pool.mark.") || name.endsWith(".tmp")) continue;
    const path = join(poolDir, name);
    try {
      const age = now - statSync(path).mtimeMs;
      out.push({ ...JSON.parse(readFileSync(path, "utf8")), ageMs: Math.round(age), fresh: age < 30000 });
    } catch {}
  }
  return out;
}

const total = (p) => p.utime + p.stime + p.cutime + p.cstime;

function snapshot() {
  const procs = scan();
  const children = new Map();
  for (const p of procs.values()) {
    const list = children.get(p.ppid) ?? [];
    list.push(p.pid);
    children.set(p.ppid, list);
  }
  const isDaemon = new Map();
  for (const p of procs.values()) {
    if (p.comm !== "MainThread" && p.comm !== "node") continue;
    if (/squeal\.mjs daemon /.test(cmdline(p.pid))) isDaemon.set(p.pid, true);
  }
  // Top-level daemons: no daemon among their ancestors (a fixture daemon of a test is a test's child).
  const daemons = [];
  for (const pid of isDaemon.keys()) {
    let a = procs.get(pid)?.ppid;
    let nested = false;
    while (a !== undefined && a > 1) {
      if (isDaemon.has(a)) nested = true;
      a = procs.get(a)?.ppid;
    }
    if (!nested) daemons.push(pid);
  }
  const owner = new Map();
  const trees = new Map();
  for (const d of daemons) {
    const tree = [];
    const stack = [d];
    while (stack.length > 0) {
      const pid = stack.pop();
      tree.push(pid);
      owner.set(pid, d);
      for (const c of children.get(pid) ?? []) stack.push(c);
    }
    trees.set(d, tree);
  }
  const marked = new Map();
  for (const p of procs.values()) {
    if (p.nice !== 10) continue;
    const env = envOf(p.pid, ["SQUEAL_DAEMON_CHILD"]);
    if (env.SQUEAL_DAEMON_CHILD !== undefined) marked.set(p.pid, env.SQUEAL_DAEMON_CHILD);
  }
  return { at: Date.now(), procs, daemons, trees, owner, marked };
}

function describe(a, b) {
  const out = [];
  for (const d of b.daemons) {
    const tree = b.trees.get(d);
    const proc = b.procs.get(d);
    const env = envOf(d, ["PWD"]);
    const cmd = cmdline(d);
    const version = /squeal\/(\d+\.\d+\.\d+)\//.exec(cmd)?.[1] ?? "?";
    // Slot processes: marked children of the daemon itself (Vitest fork workers,
    // node:test and pytest processes). Below them: what tests start.
    const slots = tree.filter((pid) => b.procs.get(pid).ppid === d && b.marked.has(pid));
    const lanes = {};
    for (const pid of slots) {
      const lane = (b.marked.get(pid).split(":").slice(1).join(":") || "?").replace(/#.*/, "");
      lanes[lane] = (lanes[lane] ?? 0) + 1;
    }
    const below = tree.length - 1 - slots.length;
    const belowComms = {};
    for (const pid of tree) {
      if (pid === d || slots.includes(pid)) continue;
      const c = b.procs.get(pid).comm;
      belowComms[c] = (belowComms[c] ?? 0) + 1;
    }
    let worktreeId = null;
    try {
      if (env.PWD) worktreeId = createHash("sha256").update(realpathSync(env.PWD)).digest("hex").slice(0, 16);
    } catch {}
    // Tree CPU over the window: every live member's own and reaped children's
    // times at the end, less the same at the start for members alive then.
    // A member that died in the window was reaped by its parent, so its whole
    // total moved into a member's cutime: its start is subtracted too. A member
    // re-parented out of the tree still counts its own growth.
    let end = 0;
    let start = 0;
    const inTree = new Set(tree);
    for (const pid of tree) end += total(b.procs.get(pid));
    for (const pid of a.trees.get(d) ?? []) {
      const q = a.procs.get(pid);
      start += total(q);
      const p = b.procs.get(pid);
      if (!inTree.has(pid) && p !== undefined && p.start === q.start) end += total(p);
    }
    const own = proc.utime + proc.stime - ((a.procs.get(d)?.utime ?? 0) + (a.procs.get(d)?.stime ?? 0));
    const seconds = (b.at - a.at) / 1000;
    out.push({
      pid: d,
      version,
      // A daemon started from a plugin cache is a session's; any other is a test's scratch daemon.
      scratch: !/\/plugins\/cache\//.test(cmd),
      worktree: env.PWD ?? null,
      worktreeId,
      slotProcesses: slots.length,
      lanes,
      processesBelowSlots: below,
      belowComms,
      treeCores: Number(((end - start) / HZ / seconds).toFixed(2)),
      daemonOwnCores: Number((own / HZ / seconds).toFixed(2)),
    });
  }
  return out.sort((x, y) => y.treeCores - x.treeCores);
}

const load0 = read("/proc/loadavg").trim();
const t0 = hostTimes();
const psi0 = psi();
const a = snapshot();
const permits0 = permitHolders();
const marks0 = marks();
await new Promise((r) => setTimeout(r, WINDOW_S * 1000));
const t1 = hostTimes();
const b = snapshot();
const permits1 = permitHolders();
const marks1 = marks();
const load1 = read("/proc/loadavg").trim();
const span = t1.total - t0.total;
const cpus = availableParallelism();
const cores = (k) => Number((((t1[k] - t0[k]) / span) * cpus).toFixed(2));
const daemons = describe(a, b);
const permitsBy = {};
for (const { pid, file } of permits1) {
  const kind = file.startsWith("pool") ? "pool" : "slow";
  permitsBy[pid] = permitsBy[pid] ?? { pool: 0, slow: 0 };
  permitsBy[pid][kind]++;
}
for (const d of daemons) {
  d.permits = permitsBy[d.pid] ?? { pool: 0, slow: 0 };
  d.mark = marks1.find((m) => m.id === d.worktreeId && m.fresh) ?? null;
}
const sessions = daemons.filter((d) => !d.scratch);
const escaped = [...b.marked.keys()].filter((pid) => !b.owner.has(pid));
const userConfig = read(join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME, ".config"), "squeal/config.json"));
const result = {
  startedAt: new Date(a.at).toISOString(),
  windowSeconds: (b.at - a.at) / 1000,
  loadavgStart: load0,
  loadavgEnd: load1,
  cpuPressureSomeAvg10: [psi0, psi()],
  cpus,
  userConfig: userConfig === null ? null : JSON.parse(userConfig),
  hostCores: {
    busy: Number((cpus - cores("idle") - cores("iowait")).toFixed(2)),
    user: cores("user"),
    nice: cores("nice"),
    system: cores("system"),
    softirq: cores("softirq"),
    iowait: cores("iowait"),
  },
  pool: {
    permitsHeldStart: permits0.length,
    permitsHeldEnd: permits1.length,
    holdersEnd: permits1,
    marksStart: marks0,
    marksEnd: marks1,
  },
  sessionDaemons: sessions.length,
  scratchDaemons: daemons.length - sessions.length,
  daemonsWithSlots: sessions.filter((d) => d.slotProcesses > 0).length,
  slotProcesses: sessions.reduce((s, d) => s + d.slotProcesses, 0),
  slotProcessesWithoutMark: sessions.filter((d) => d.mark === null).reduce((s, d) => s + d.slotProcesses, 0),
  processesBelowSlots: sessions.reduce((s, d) => s + d.processesBelowSlots, 0),
  markedOutsideAnyDaemonTree: escaped.length,
  sessionTreeCores: Number(sessions.reduce((s, d) => s + d.treeCores, 0).toFixed(2)),
  scratchTreeCores: Number(daemons.filter((d) => d.scratch).reduce((s, d) => s + d.treeCores, 0).toFixed(2)),
  daemons,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
