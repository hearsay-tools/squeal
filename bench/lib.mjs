// Shared helpers for the benchmark scripts. No dependencies beyond Node.
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
 * What a daemon's `status --json` still waits for before its start-up baseline is done, or null:
 * "status" (none read), "daemon" (not alive yet: status read the store alone, so its zero counts
 * mean nothing, review 0.1.626 wt-3), "listing", "checks", "testFiles", "code" (files not counted,
 * or the code store not made yet: `files` 0 in a project with test files) or "lint" (pending,
 * less what waits for a pause or a manual run). A field an older Squeal version does not print
 * does not hold the wait (rows 025-08, 025-13).
 */
export function baselineWaitingFor(status) {
  if (!status || typeof status !== "object") return "status";
  if (status.daemon && status.daemon.state !== "alive") return "daemon";
  if (status.testFilesListed === false) return "listing";
  if ((status.counts?.pending ?? 0) !== 0) return "checks";
  if ((status.testFilesWithoutChecks?.pending ?? 0) !== 0) return "testFiles";
  if (codeWaiting(status)) return "code";
  if (lintWaiting(status.lint)) return "lint";
  return null;
}

/** The code store has files to count, or has none yet in a project with test files. */
function codeWaiting({ code, testFileCounts }) {
  if (!code) return false;
  if ((code.pending ?? 0) !== 0) return true;
  const testFiles = Object.values(testFileCounts ?? {}).reduce((a, n) => a + (n ?? 0), 0);
  return code.files === 0 && testFiles > 0;
}

/** Lint checks pending, less those a lint group holds for a pause or a manual run. */
function lintWaiting(lint) {
  if (!lint) return false;
  const held = (lint.awaitingRun ?? []).reduce((a, r) => a + (r.checks ?? 0), 0);
  return (lint.pending ?? 0) - (lint.awaitingPause ?? 0) - held > 0;
}

/** Whether `baselineWaitingFor(status)` waits for nothing. */
export function baselineSettled(status) {
  return baselineWaitingFor(status) === null;
}

/**
 * Polls `read(root)` (a parsed `status --json`, or null) for each root until `baselineSettled`,
 * or until `timeoutMs` from the first poll. Roots wait one after the other; the deadline is shared.
 * Returns one { ms, settled, polls, waitingFor, code } per root, in order: `waitingFor` is what
 * the last poll still waited for (null when settled), `code` its code store counts
 * ({ files, pending }, null when that status has none).
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
    let status = null;
    let waitingFor = null;
    for (;;) {
      polls++;
      status = await read(root);
      waitingFor = baselineWaitingFor(status);
      if (waitingFor === null || now() - t0 >= timeoutMs) break;
      await wait(pollMs);
    }
    const code = status?.code ? { files: status.code.files, pending: status.code.pending } : null;
    out.push({ ms: now() - r0, settled: waitingFor === null, polls, waitingFor, code });
  }
  return out;
}

/**
 * Waits until `cpuS()` (CPU seconds used so far, as `storeProcessMeter().cpuS`) grows by under
 * `maxPct` percent of one core over `windowMs`, or until `timeoutMs`. Returns
 * { ms, settled, polls, lastPct }: `lastPct` is the last window's CPU percent.
 */
export async function waitForQuiet(
  cpuS,
  {
    windowMs = 2000,
    maxPct = 2,
    timeoutMs = 60_000,
    now = () => performance.now(),
    wait = sleep,
  } = {},
) {
  const t0 = now();
  let polls = 0;
  let lastPct = null;
  for (;;) {
    polls++;
    const a = cpuS();
    const w0 = now();
    await wait(windowMs);
    lastPct = (100 * (cpuS() - a)) / Math.max(0.001, (now() - w0) / 1000);
    if (lastPct < maxPct) return { ms: now() - t0, settled: true, polls, lastPct };
    if (now() - t0 >= timeoutMs) return { ms: now() - t0, settled: false, polls, lastPct };
  }
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

/**
 * Reads, and copies to `copyTo`, every daemon and store-process log in `logDir`: the store's
 * long writes and lock failures, the store process's log, the relay and D9's hook write waits.
 * The caller reads them after `squeal stop` (review 0.1.626 S2), so the shutdown summaries count.
 */
export function readDaemonLogs(logDir, copyTo) {
  let longWrites = 0;
  const holds = [];
  let lockFailures = 0;
  let storeLog = "";
  let relay = "";
  mkdirSync(copyTo, { recursive: true });
  if (existsSync(logDir)) {
    for (const f of readdirSync(logDir)) {
      const text = readFileSync(join(logDir, f), "utf8");
      longWrites += longWriteCount(text);
      holds.push(...longWriteHolds(text));
      lockFailures += (text.match(/SQLITE_BUSY|database is locked/gi) ?? []).length;
      if (f.startsWith("store-")) storeLog += text;
      else relay += text;
      cpSync(join(logDir, f), join(copyTo, f));
    }
  }
  return {
    store: { longWrites, lockFailures, longWriteHoldsMs: holds },
    storeProcess: { ...storeProcessLog(storeLog), relay: relayLog(relay) },
    // Spec 025 D9: how long hook writes waited for the daemon's main thread; seen false before D9.
    hookWriteWait: hookWriteWaitLog(relay),
  };
}
