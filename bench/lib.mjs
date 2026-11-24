// Shared helpers for the benchmark scripts. No dependencies beyond Node.
import { execFile, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** Runs a command, returns { ms, code, stdout, stderr }. Never throws on a non-zero exit. */
export function timed(cmd, args, { input, env, cwd, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = execFile(
      cmd,
      args,
      { env, cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          ms: performance.now() - t0,
          code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
          killed: Boolean(error?.killed),
          stdout,
          stderr,
        });
      },
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Starts a detached background process; returns the ChildProcess. */
export function background(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: "ignore", ...opts });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mulberry32: a small seeded PRNG, so every run edits the same files in the same order. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(values, q) {
  // Infinity stays in: a timed-out wait counts as slower than every other value.
  const v = values.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return v[lo];
  if (v[hi] === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export const CLK_TCK = 100;

/** /proc/<pid>/stat: own and reaped-children CPU seconds, and RSS bytes. */
export function procStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    // rest[0] is field 3 (state). utime=14, stime=15, cutime=16, cstime=17, ppid=4, rss=24.
    const f = (n) => Number(rest[n - 3]);
    return {
      ppid: f(4),
      ownCpuS: (f(14) + f(15)) / CLK_TCK,
      childCpuS: (f(16) + f(17)) / CLK_TCK,
      rssBytes: f(24) * 4096,
    };
  } catch {
    return null;
  }
}

export function cmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
  } catch {
    return "";
  }
}

export function allPids() {
  return readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .map(Number);
}

/** Daemon pids by worktree root: the daemon's cmdline ends with `daemon <root>`. */
export function daemonPids() {
  const out = new Map();
  for (const pid of allPids()) {
    const c = cmdline(pid);
    const m = /squeal\.mjs daemon (\S+)$/.exec(c);
    if (m) out.set(m[1], pid);
  }
  return out;
}

/** RSS of `root` and all its live descendants, in bytes. */
export function treeRss(root, pids = allPids()) {
  const children = new Map();
  const stats = new Map();
  for (const pid of pids) {
    const s = procStat(pid);
    if (!s) continue;
    stats.set(pid, s);
    if (!children.has(s.ppid)) children.set(s.ppid, []);
    children.get(s.ppid).push(pid);
  }
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    const s = stats.get(p);
    if (s) total += s.rssBytes;
    for (const c of children.get(p) ?? []) stack.push(c);
  }
  return total;
}

/** Busy and total jiffies from /proc/stat, for whole-machine CPU use. */
export function cpuJiffies() {
  const line = readFileSync("/proc/stat", "utf8")
    .split("\n")[0]
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const idle = line[3] + line[4];
  const total = line.reduce((a, b) => a + b, 0);
  return { busy: total - idle, total };
}

/** Store process pids (spec 021 D22): cmdline `... squeal.mjs store-process <commonDir> --store <name>`. */
export function storeProcessPids() {
  const out = new Map();
  for (const pid of allPids()) {
    const m = /squeal\.mjs store-process (\S+) --store (\S+)/.exec(cmdline(pid));
    if (m) out.set(pid, `${m[1]}:${m[2]}`);
  }
  return out;
}

/**
 * CPU seconds of every store process seen so far, as a running total: a store
 * process exits a few minutes after its last client, so its CPU is read while
 * it lives and kept after it ends. Call `sample()` often (the cell does every second).
 */
export function storeProcessMeter() {
  const last = new Map();
  return {
    sample() {
      let rss = 0;
      for (const pid of storeProcessPids().keys()) {
        const s = procStat(pid);
        if (!s) continue;
        last.set(pid, s.ownCpuS);
        rss += s.rssBytes;
      }
      return rss;
    },
    cpuS: () => [...last.values()].reduce((a, b) => a + b, 0),
    pids: () => [...last.keys()],
  };
}

/** The store process's own numbers from its log (`logs/store-*.log`, spec 021 D22.6). */
export function storeProcessLog(text) {
  const stats = { written: 0, failed: 0, queueWaitMaxMs: 0, busyMs: 0, stops: 0, failedLines: 0 };
  const re = /(\d+) written, (\d+) failed, queue wait p50 \d+ ms max (\d+) ms, busy (\d+) ms/g;
  for (const m of text.matchAll(re)) {
    stats.written += Number(m[1]);
    stats.failed += Number(m[2]);
    stats.queueWaitMaxMs = Math.max(stats.queueWaitMaxMs, Number(m[3]));
    stats.busyMs += Number(m[4]);
  }
  stats.stops = (text.match(/store process: stopping/g) ?? []).length;
  stats.failedLines = (text.match(/store process: a batch of \S+ failed/g) ?? []).length;
  return stats;
}

/** The daemons' side (relay-counts.ts): `code store: last minute: N batches through the store process, D written here (...), F failed`. */
export function relayLog(text) {
  const stats = { sent: 0, direct: 0, failed: 0 };
  const re =
    /code store: last minute: (\d+) batches through the store process, (\d+) written here[^,]*(?:\([^)]*\))?, (\d+) failed/g;
  for (const m of text.matchAll(re)) {
    stats.sent += Number(m[1]);
    stats.direct += Number(m[2]);
    stats.failed += Number(m[3]);
  }
  return stats;
}

/** Runs a command and samples its process tree's RSS every 100 ms: { ms, code, peakRssBytes, stdout }. */
export function timedPeak(cmd, args, { env, cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let peak = 0;
    let stdout = "";
    const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (d) => {
      if (stdout.length < 1 << 20) stdout += d;
    });
    const tick = setInterval(() => {
      peak = Math.max(peak, treeRss(child.pid));
    }, 100);
    const kill = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearInterval(tick);
      clearTimeout(kill);
      resolve({ ms: performance.now() - t0, code, peakRssBytes: peak, stdout });
    });
  });
}

/** Lock holds the logs name (`... write lock held N ms ...`, only those over 250 ms are logged). */
export function longWriteHolds(text) {
  return [...text.matchAll(/write lock held (\d+) ms/g)].map((m) => Number(m[1]));
}

/**
 * Whether a daemon's `status --json` shows its start-up baseline done: test files listed,
 * nothing pending in the checks, the test files without checks or the code counts.
 * A field an older Squeal version does not print does not hold the wait (row 025-08).
 */
export function baselineSettled(status) {
  if (!status || typeof status !== "object") return false;
  if (status.testFilesListed === false) return false;
  if ((status.counts?.pending ?? 0) !== 0) return false;
  if ((status.testFilesWithoutChecks?.pending ?? 0) !== 0) return false;
  if (status.code && (status.code.pending ?? 0) !== 0) return false;
  return true;
}

/**
 * Polls `read(root)` (a parsed `status --json`, or null) for each root until `baselineSettled`,
 * or until `timeoutMs` from the first poll. Roots wait one after the other; the deadline is shared.
 * Returns one { ms, settled, polls } per root, in order.
 */
export async function waitForBaselines(
  roots,
  read,
  { timeoutMs = 300_000, pollMs = 1000, now = () => performance.now(), wait = sleep } = {},
) {
  const t0 = now();
  const out = [];
  for (const root of roots) {
    const r0 = now();
    let polls = 0;
    let settled = false;
    for (;;) {
      polls++;
      settled = baselineSettled(await read(root));
      if (settled || now() - t0 >= timeoutMs) break;
      await wait(pollMs);
    }
    out.push({ ms: now() - r0, settled, polls });
  }
  return out;
}

/**
 * Hook write waits from the daemon logs (spec 025 D9): each `long write wait: hook write waited
 * N ms` line, and the periodic `hook writes: N taken, queue wait p95 P ms max M ms` summaries.
 * `seen` is false when no such line exists, as with a Squeal version before D9.
 */
export function hookWriteWaitLog(text) {
  const longWaitsMs = [...text.matchAll(/long write wait: hook write waited (\d+) ms/g)].map((m) =>
    Number(m[1]),
  );
  const stats = { seen: longWaitsMs.length > 0, taken: 0, p95MaxMs: null, maxMs: null };
  const re = /hook writes: (\d+) taken, queue wait p95 (\d+) ms max (\d+) ms/g;
  for (const m of text.matchAll(re)) {
    stats.seen = true;
    stats.taken += Number(m[1]);
    stats.p95MaxMs = Math.max(stats.p95MaxMs ?? 0, Number(m[2]));
    stats.maxMs = Math.max(stats.maxMs ?? 0, Number(m[3]));
  }
  if (longWaitsMs.length > 0) stats.maxMs = Math.max(stats.maxMs ?? 0, ...longWaitsMs);
  return { ...stats, longWaitsMs };
}

/** Store writes that held the lock over 250 ms; not D9's `long write wait:` lines, which are no lock holds. */
export function longWriteCount(text) {
  return (text.match(/long write(?! wait)/gi) ?? []).length;
}
