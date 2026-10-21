// Throwaway probe for research 014-02. Read-only: reads /proc and /sys, signals nothing,
// connects to no socket. Usage: node snapshot.mjs [intervalMs] [--no-smaps] [--json]
// Prints one snapshot of every Squeal daemon of this user, its test processes and the host,
// with the time each step took.
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { availableParallelism, cpus, loadavg, userInfo } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const intervalMs = Number(args.find((a) => /^\d+$/.test(a)) ?? 1000);
const withSmaps = !args.includes("--no-smaps");
const asJson = args.includes("--json");
const TICKS = 100;
const PAGE_KB = 4;
const uid = userInfo().uid;
const timings = {};
const cpu0 = process.cpuUsage();
const t0 = performance.now();

function time(name, fn) {
  const at = performance.now();
  const value = fn();
  timings[name] = +(performance.now() - at).toFixed(1);
  return value;
}
async function timeAsync(name, fn) {
  const at = performance.now();
  const value = await fn();
  timings[name] = +(performance.now() - at).toFixed(1);
  return value;
}

function read(path) {
  try {
    return readFileSync(path, "latin1");
  } catch {
    return null;
  }
}

/** /proc/<pid>/stat fields after the command name; field n of proc(5) is fields[n - 3]. */
function stat(pid) {
  const text = read(`/proc/${pid}/stat`);
  if (text === null) return null;
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const f = text.slice(close + 2).split(" ");
  return {
    pid,
    comm: text.slice(open + 1, close),
    state: f[0],
    ppid: +f[1],
    pgrp: +f[2],
    utime: +f[11],
    stime: +f[12],
    nice: +f[16],
    threads: +f[17],
    start: +f[19],
    rssKb: +f[21] * PAGE_KB,
  };
}

function uptimeTicks() {
  return Math.floor(Number(read("/proc/uptime").split(" ")[0]) * TICKS);
}

function hostCpu() {
  const line = read("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = line[3] + line[4];
  const total = line.slice(0, 8).reduce((a, b) => a + b, 0);
  return { idle, total };
}

function kv(text) {
  const out = {};
  for (const line of (text ?? "").split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) out[m[1]] = +m[2];
  }
  return out;
}

function pressure(name) {
  const text = read(`/proc/pressure/${name}`);
  if (text === null) return null;
  const out = {};
  for (const line of text.trim().split("\n")) {
    const [kind, ...rest] = line.split(" ");
    out[kind] = Object.fromEntries(rest.map((p) => p.split("=")).map(([k, v]) => [k, +v]));
  }
  return out;
}

const procNames = () => readdirSync("/proc").filter((n) => /^\d+$/.test(n));

// 1. Every process, first sample.
const host0 = hostCpu();
const up0 = uptimeTicks();
const at0 = performance.now();
const table0 = time("scanStat0", () => {
  const m = new Map();
  for (const n of procNames()) {
    const s = stat(+n);
    if (s !== null) m.set(s.pid, s);
  }
  return m;
});

// 2. Daemons: command line names squeal.mjs (or the CLI) and "daemon".
const cmdlines = new Map();
const daemons = await timeAsync("daemonsByCmdline", async () => {
  const found = [];
  await Promise.all(
    [...table0.values()].map(async (s) => {
      let text;
      try {
        text = (await readFile(`/proc/${s.pid}/cmdline`, "latin1")).split("\0").filter(Boolean);
      } catch {
        return;
      }
      cmdlines.set(s.pid, text);
      const i = text.findIndex((a) => /squeal(\.mjs)?$/.test(a) || /squeal\.mjs$/.test(a));
      if (i >= 0 && text[i + 1] === "daemon") found.push(s.pid);
    }),
  );
  return found.sort((a, b) => a - b);
});

// 3. Descendants by ppid, and members of each daemon's group.
const children = new Map();
for (const s of table0.values()) children.set(s.ppid, [...(children.get(s.ppid) ?? []), s.pid]);
const families = time("families", () =>
  daemons.map((d) => {
    const desc = new Set();
    const queue = [...(children.get(d) ?? [])];
    for (let p = queue.pop(); p !== undefined; p = queue.pop()) {
      if (desc.has(p)) continue;
      desc.add(p);
      queue.push(...(children.get(p) ?? []));
    }
    const group = [...table0.values()].filter((s) => s.pgrp === d && s.pid !== d && !desc.has(s.pid));
    return { daemon: d, descendants: [...desc], groupOnly: group.map((s) => s.pid) };
  }),
);

// 4. The mark of every process of this user (environ is readable only for our own).
const marks = await timeAsync("environAllOwn", async () => {
  const out = new Map();
  await Promise.all(
    [...table0.keys()].map(async (pid) => {
      let env;
      try {
        env = await readFile(`/proc/${pid}/environ`, "latin1");
      } catch {
        return;
      }
      const at = env.indexOf("SQUEAL_DAEMON_CHILD=");
      if (at >= 0) out.set(pid, env.slice(at + 20, env.indexOf("\0", at) >>> 0));
    }),
  );
  return out;
});

const ours = new Set([...daemons, ...families.flatMap((f) => [...f.descendants, ...f.groupOnly]), ...marks.keys()]);

// 5. Memory per process: status, and smaps_rollup (PSS, USS, swap).
const memory = new Map();
time("statusOurs", () => {
  for (const pid of ours) memory.set(pid, { status: kv(read(`/proc/${pid}/status`)) });
});
const smapsMs = {};
if (withSmaps)
  time("smapsRollupOurs", () => {
    for (const pid of ours) {
      const at = performance.now();
      const r = kv(read(`/proc/${pid}/smaps_rollup`));
      smapsMs[pid] = +(performance.now() - at).toFixed(1);
      memory.get(pid).smaps = r;
    }
  });

// 6. Threads of each daemon by name (Vitest's threads pool runs in the daemon).
const threadNames = time("daemonThreads", () =>
  Object.fromEntries(
    daemons.map((d) => {
      const names = {};
      for (const t of (() => {
        try {
          return readdirSync(`/proc/${d}/task`);
        } catch {
          return [];
        }
      })()) {
        const c = (read(`/proc/${d}/task/${t}/comm`) ?? "?").trim();
        names[c] = (names[c] ?? 0) + 1;
      }
      return [d, names];
    }),
  ),
);

// 7. Host: load, pressure, memory, cgroup of each daemon.
const host = time("host", () => ({
  loadavg: loadavg(),
  availableParallelism: availableParallelism(),
  cpus: cpus().length,
  cpuPressure: pressure("cpu"),
  memoryPressure: pressure("memory"),
  ioPressure: pressure("io"),
  meminfo: (({ MemTotal, MemAvailable, SwapTotal, SwapFree }) => ({ MemTotal, MemAvailable, SwapTotal, SwapFree }))(
    kv(read("/proc/meminfo")),
  ),
  cgroups: [...new Set(daemons.map((d) => (read(`/proc/${d}/cgroup`) ?? "").trim()))],
}));

// 8. Second sample of our processes only, after the interval.
const wait = Math.max(0, intervalMs - (performance.now() - at0));
await sleep(wait);
const up1 = uptimeTicks();
const host1 = hostCpu();
const table1 = time("stat1Ours", () => new Map([...ours].map((p) => [p, stat(p)]).filter(([, s]) => s !== null)));
const elapsedTicks = up1 - up0;

const rows = [];
for (const pid of ours) {
  const a = table0.get(pid);
  const b = table1.get(pid);
  if (a === undefined) continue;
  // Gone before the second sample: its memory reads are empty, so it is left out.
  if (b === undefined || b.start !== a.start) continue;
  const same = b !== undefined && b.start === a.start;
  const cpuPct = same && elapsedTicks > 0 ? (100 * (b.utime + b.stime - a.utime - a.stime)) / elapsedTicks : null;
  const age = up0 - a.start;
  const life = age > 0 ? (100 * (a.utime + a.stime)) / age : null;
  const m = memory.get(pid) ?? {};
  const fam = families.find((f) => f.daemon === pid || f.descendants.includes(pid) || f.groupOnly.includes(pid));
  rows.push({
    pid,
    ppid: a.ppid,
    pgrp: a.pgrp,
    daemon: fam?.daemon ?? null,
    role: daemons.includes(pid) ? "daemon" : fam?.groupOnly.includes(pid) ? "group-orphan" : fam ? "descendant" : "mark-only",
    mark: marks.get(pid) ?? null,
    nice: a.nice,
    threads: a.threads,
    ageS: +(age / TICKS).toFixed(0),
    cpuPct: cpuPct === null ? null : +cpuPct.toFixed(1),
    lifeCpuPct: life === null ? null : +life.toFixed(1),
    rssKb: m.status?.VmRSS ?? null,
    anonKb: m.status?.RssAnon ?? null,
    fileKb: m.status?.RssFile ?? null,
    shmemKb: m.status?.RssShmem ?? null,
    swapKb: m.status?.VmSwap ?? null,
    pssKb: m.smaps?.Pss ?? null,
    ussKb: m.smaps?.Private_Dirty === undefined ? null : m.smaps.Private_Clean + m.smaps.Private_Dirty,
    swapPssKb: m.smaps?.SwapPss ?? null,
    smapsMs: smapsMs[pid] ?? null,
    cmd: (cmdlines.get(pid) ?? [a.comm]).join(" ").slice(0, 160),
  });
}

const hostBusyPct =
  host1.total > host0.total ? (100 * (1 - (host1.idle - host0.idle) / (host1.total - host0.total))) : null;
const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const totals = {
  processes: rows.length,
  daemons: daemons.length,
  cpuPctOfOneCpu: +sum("cpuPct").toFixed(1),
  hostBusyPctOfAll: hostBusyPct === null ? null : +hostBusyPct.toFixed(1),
  squealShareOfHostCpuPct:
    hostBusyPct === null ? null : +((sum("cpuPct") / host.cpus) / hostBusyPct * 100).toFixed(1),
  rssMiB: +(sum("rssKb") / 1024).toFixed(0),
  pssMiB: +(sum("pssKb") / 1024).toFixed(0),
  ussMiB: +(sum("ussKb") / 1024).toFixed(0),
  swapMiB: +(sum("swapKb") / 1024).toFixed(0),
  anonPlusShmemMiB: +((sum("anonKb") + sum("shmemKb")) / 1024).toFixed(0),
  fileMiB: +(sum("fileKb") / 1024).toFixed(0),
  usedMiB: +((host.meminfo.MemTotal - host.meminfo.MemAvailable) / 1024).toFixed(0),
};
totals.squealShareOfUsedMemPct = +((100 * totals.pssMiB) / totals.usedMiB).toFixed(1);
const cpu1 = process.cpuUsage(cpu0);
timings.totalWallMs = +(performance.now() - t0).toFixed(1);
timings.workWallMs = +(timings.totalWallMs - wait).toFixed(1);
timings.probeCpuMs = +((cpu1.user + cpu1.system) / 1000).toFixed(1);
timings.probeSysCpuMs = +(cpu1.system / 1000).toFixed(1);
timings.processesScanned = table0.size;

const out = { at: new Date().toISOString(), intervalMs, withSmaps, timings, host, totals, threadNames, rows };
if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`at ${out.at} load ${host.loadavg.map((l) => l.toFixed(2)).join(" ")} interval ${intervalMs} ms`);
  console.log("timings", JSON.stringify(timings));
  console.log("totals", JSON.stringify(totals));
  console.log(
    "host",
    JSON.stringify({ cpuPressure: host.cpuPressure, memoryPressure: host.memoryPressure, meminfo: host.meminfo, cgroups: host.cgroups }),
  );
  for (const r of rows.sort((a, b) => (a.daemon ?? 0) - (b.daemon ?? 0) || (a.role === "daemon" ? -1 : 1)))
    console.log(
      [r.pid, r.role, `d=${r.daemon}`, `ni=${r.nice}`, `cpu=${r.cpuPct}`, `life=${r.lifeCpuPct}`, `rss=${(r.rssKb / 1024) | 0}M`, `pss=${(r.pssKb / 1024) | 0}M`, `uss=${(r.ussKb / 1024) | 0}M`, `swap=${(r.swapKb / 1024) | 0}M`, `smaps=${r.smapsMs}ms`, `mark=${r.mark}`, r.cmd.slice(0, 90)].join(" "),
    );
}
