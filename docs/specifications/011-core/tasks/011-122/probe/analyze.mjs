// Task 011-122: the phases between the store lock freeing and the edit's revision, per probe run.
// Usage: node analyze.mjs <results-dir> [--suite <suite.log>]   Prints one row per run, then a summary.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const suiteLog = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;
const summaries = readFileSync(join(dir, "summary.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// Locked full-suite windows, from suite.log: [start, end] in ms.
const windows = [];
if (suiteLog && existsSync(suiteLog)) {
  const starts = new Map();
  for (const line of readFileSync(suiteLog, "utf8").trim().split("\n")) {
    const m = /^(\d+) suite (\d+) (start|end)/.exec(line);
    if (!m) continue;
    if (m[3] === "start") starts.set(m[2], Number(m[1]) * 1000);
    else windows.push([starts.get(m[2]), Number(m[1]) * 1000]);
  }
  for (const [n, s] of starts) if (!windows.some(([a]) => a === s)) windows.push([s, Infinity]);
}
// Or from load-sampler logs: a run is beside a locked suite when every sample in its window has full>=1.
const samples = [];
for (const [i, arg] of process.argv.entries()) {
  if (arg !== "--load") continue;
  for (const path of process.argv[i + 1].split(",")) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").trim().split("\n")) {
      const m = /^(\d+) ([\d.]+) [\d.]+ [\d.]+(?: full=(\d+))?/.exec(line);
      if (m && m[3] !== undefined) samples.push([Number(m[1]) * 1000, Number(m[3]), Number(m[2])]);
    }
  }
}
const beside = (a, b) => {
  if (samples.length > 0) {
    const inside = samples.filter(([at]) => at >= a - 5000 && at <= b + 5000);
    return inside.length > 0 && inside.every(([, full]) => full >= 1);
  }
  return windows.some(([s, e]) => s <= a && b <= e);
};

function events(run) {
  const path = join(dir, `run-${run}.log`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").map((line) => {
    const [at, , thread, name, ...rest] = line.split(" ");
    return { at: Number(at), thread, name, d: rest.length ? JSON.parse(rest.join(" ")) : {} };
  }).filter((e) => e.thread === "t0");
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const rows = [];
for (const s of summaries) {
  const ev = events(s.run);
  const free = s.freed ?? s.freeAt;
  const created = s.createdAt;
  const row = { run: s.run, ok: s.ok, load: s.loadStart, test: created - s.freeAt, late: free - s.freeAt, daemon: created - free, hb: (s.heartbeatAt ?? NaN) - free };
  row.beside = windows.length || samples.length ? beside(s.epoch - 2000, (created ?? s.freeAt) + 1000) : null;
  // The landing pass: the last retry-pass at or before the pass-phases event that stored the revision.
  const stored = ev.find((e) => e.name === "pass-phases" && e.d.revision === s.revision);
  if (stored === undefined || created === undefined) { rows.push({ ...row, note: "no stored pass" }); continue; }
  const before = ev.filter((e) => e.at <= stored.at);
  const last = (name, after = -Infinity) => before.filter((e) => e.name === name && e.at >= after).at(-1);
  // The storing batch: its scheduler entry, and what started it, a retry of a failed pass or a debounced batch.
  const enter = last("hb-enter");
  const locked = last("hb-locked", enter.at);
  const batch = last("batch-phases", enter.at);
  const failed = before.filter((e) => e.name === "hb-pass-failed").at(-1);
  const retry = failed === undefined ? undefined : last("retry-pass", failed.at);
  const emit = retry === undefined ? undefined : last("rec-emit", retry.at);
  const fresh = retry === undefined ? last("feed-debounced") : undefined;
  const tx = ev.find((e) => e.name === "tx" && e.at >= stored.at - 5 && /reconcileBatch/.test(e.d.at));
  // At the free: in its slice (a pass that started before it), in the retry's pause, or no pass yet.
  row.state = retry === undefined ? (enter.at > free ? "no pass yet" : "running") : retry.at > free ? "pause" : "running";
  row.attempt = retry?.d.attempt ?? null;
  const clip = (a, b) => (a === undefined || b === undefined ? 0 : overlap(a, b, free, Infinity));
  row.pause = retry ? clip(retry.at - retry.d.pausedMs, retry.at) : 0;
  // The feed's work before the scheduler: a retry's git status and walk, or a fresh batch's debounce and hints.
  row.prelude = retry ? clip(retry.at, emit?.at) : clip(fresh?.at, enter.at);
  row.gitStatus = emit?.d.gitStatusMs ?? null;
  row.spec = emit?.d.specMs ?? null;
  row.mutex = clip(enter.at, locked?.at);
  row.toTx = clip(locked?.at, batch?.at);
  row.head = batch?.d.headMs ?? null;
  row.tx = clip(batch?.at, created);
  row.txWait = tx?.d.waitMs ?? null;
  row.stalls = ev.filter((e) => e.name === "stall").reduce((sum, e) => sum + overlap(e.d.fromMs, e.at, free, created), 0);
  // Who wrote first after the lock freed.
  const first = ev.find((e) => e.name === "tx" && e.at >= free);
  row.firstWriter = first ? first.d.at.split(" < ")[1]?.split("@")[0] ?? first.d.at : null;
  row.firstWriteAt = first ? first.at - free : null;
  row.pumpBusy = ev.filter((e) => e.name === "pump-gave-up").length;
  row.flyDuringHold = ev.filter((e) => (e.name === "tier-fly" || e.name === "tier-record-wait") && e.at >= s.epoch && e.at <= free).length;
  rows.push(row);
}
const cols = ["run", "ok", "beside", "load", "test", "late", "daemon", "hb", "state", "attempt", "pause", "prelude", "gitStatus", "spec", "mutex", "toTx", "head", "tx", "txWait", "stalls", "firstWriter", "firstWriteAt", "pumpBusy", "flyDuringHold", "note"];
console.log(cols.join("\t"));
for (const r of rows) console.log(cols.map((c) => (typeof r[c] === "number" ? Math.round(r[c]) : r[c] ?? "")).join("\t"));
const num = (c) => rows.map((r) => r[c]).filter((v) => typeof v === "number" && !Number.isNaN(v)).sort((a, b) => a - b);
const q = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN;
console.log("\nphase\tmin\tmedian\tp90\tmax\tn");
for (const c of ["test", "late", "daemon", "hb", "pause", "prelude", "gitStatus", "spec", "mutex", "toTx", "head", "tx", "stalls", "load"]) {
  const xs = num(c);
  console.log([c, xs[0], q(xs, 0.5), q(xs, 0.9), xs.at(-1), xs.length].map((v) => (typeof v === "number" ? Math.round(v) : v)).join("\t"));
}
