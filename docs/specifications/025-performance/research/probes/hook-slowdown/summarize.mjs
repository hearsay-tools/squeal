#!/usr/bin/env node
// Throwaway (row 025-26). Reduces the fetched profile.mjs output to summary.json:
//   node summarize.mjs <fetched out dir> <summary.json>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, dest] = process.argv.slice(2);
const q = (a, p) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
};
const stats = (a) => ({ n: a.length, min: q(a, 0), p50: q(a, 0.5), p95: q(a, 0.95), max: q(a, 1) });

/** Self time per function and per bundle file from a .cpuprofile; idle and GC kept apart. */
function profileSummary(file, top = 25) {
  const p = JSON.parse(readFileSync(file, "utf8"));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const id = p.samples[i];
    dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0));
  }
  const fn = new Map();
  const url = new Map();
  let total = 0;
  let idle = 0;
  for (const [id, us] of dt) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const name = cf.functionName || "(anonymous)";
    if (name === "(idle)") {
      idle += us;
      continue;
    }
    total += us;
    const short = cf.url.replace(/^.*\/(plugin[^/]*|plugins\/[^/]+)\//, "").replace(/^file:\/\//, "");
    const key = `${name} ${short}:${cf.lineNumber + 1}`;
    fn.set(key, (fn.get(key) ?? 0) + us);
    url.set(short || name, (url.get(short || name) ?? 0) + us);
  }
  const ms = (us) => Math.round(us / 100) / 10;
  const sorted = (m) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, us]) => [k, ms(us)]);
  return {
    wallMs: ms(p.endTime - p.startTime),
    busyMs: ms(total),
    idleMs: ms(idle),
    topFunctions: sorted(fn),
    topFiles: sorted(url),
  };
}

/** Inclusive time of each function name (any frame on the stack), for call-tree questions. */
function inclusive(file, names) {
  const p = JSON.parse(readFileSync(file, "utf8"));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const out = Object.fromEntries(names.map((n) => [n, 0]));
  for (let i = 0; i < p.samples.length; i++) {
    const seen = new Set();
    for (let id = p.samples[i]; id !== undefined; id = parent.get(id)) {
      const name = byId.get(id).callFrame.functionName;
      if (name in out && !seen.has(name)) {
        out[name] += p.timeDeltas[i] ?? 0;
        seen.add(name);
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, us]) => [k, Math.round(us / 1000)]));
}

function sessionStats(file) {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const by = {};
  for (const r of rows) {
    if (r.kind === "hook") (by[r.hook] ??= []).push(r.ms);
    if (r.kind === "step" && r.type === "status") {
      (by.status ??= []).push(r.statusMs);
      (by.statusJson ??= []).push(r.statusJsonMs);
    }
  }
  const edits = rows.filter((r) => r.kind === "step" && r.type !== "status").length;
  return { edits, ...Object.fromEntries(Object.entries(by).map(([k, a]) => [k, stats(a)])) };
}

function countsOf(runDir) {
  const out = {};
  const base = join(runDir, "counts");
  if (!existsSync(base)) return out;
  for (const d of readdirSync(base)) {
    const kind = d.replace(/-\d+$/, "");
    for (const f of readdirSync(join(base, d))) {
      const c = JSON.parse(readFileSync(join(base, d, f), "utf8"));
      // The hook launcher may run more than one Node process; keep the one that ran SQL.
      const sql = Object.values(c.sql).reduce((a, b) => a + b, 0);
      const fsn = Object.values(c.fs).reduce((a, b) => a + b, 0);
      (out[kind] ??= []).push({ argv: c.argv.join(" ").slice(-60), sql, fs: fsn, statements: c.sql, files: c.fs });
    }
  }
  return out;
}

const runs = readdirSync(dir).filter((d) => /^\d+\.\d+\.\d+-r\d+$/.test(d) && existsSync(join(dir, d, "result.json")));
const summary = {};
for (const run of runs.sort()) {
  const rd = join(dir, run);
  const r = JSON.parse(readFileSync(join(rd, "result.json"), "utf8"));
  const s = {
    runAllMs: Math.round(r.runAll.ms),
    sessionStartMs: Math.round(r.sessionStart),
    quiet: Object.fromEntries(Object.entries(r.quiet).map(([k, a]) => [k, stats(a)])),
    quietCpu: r.quietCpu,
    busy: { ...r.busy, cpu: r.busyCpu, session: sessionStats(join(rd, "session-busy.jsonl")) },
    profiled: r.profiled,
    counts: Object.fromEntries(
      Object.entries(countsOf(rd)).map(([k, list]) => [
        k,
        list.filter((x) => x.sql > 0 || x.fs > 0).map((x) => ({ argv: x.argv, sql: x.sql, fs: x.fs })),
      ]),
    ),
    callProfiles: {},
    processProfiles: {},
  };
  const pd = join(rd, "prof");
  for (const d of existsSync(pd) ? readdirSync(pd) : []) {
    if (d.endsWith(".cpuprofile")) {
      s.processProfiles[d.replace(".cpuprofile", "")] = profileSummary(join(pd, d), 40);
      continue;
    }
    for (const f of readdirSync(join(pd, d))) {
      const ps = profileSummary(join(pd, d, f), 12);
      (s.callProfiles[d.replace(/-\d+$/, "")] ??= []).push(ps);
    }
  }
  summary[run] = s;
}
if (process.argv[4] === "--inclusive") {
  // node summarize.mjs <dir> <dest> --inclusive <run> <process> name1,name2
  const [, , , , run, proc, names] = process.argv;
  console.log(JSON.stringify(inclusive(join(dir, run, "prof", `${proc}.cpuprofile`), names.split(",")), null, 2));
} else {
  writeFileSync(dest, `${JSON.stringify(summary, null, 1)}\n`);
  for (const [run, s] of Object.entries(summary)) {
    const qq = s.quiet;
    const cpu = s.busy.cpu.daemonTree / Math.max(1, s.busy.session?.edits ?? 1);
    console.log(
      `${run} runAll ${s.runAllMs} | quiet p50 pre ${qq.pre.p50} post ${qq.post.p50} status ${qq.status.p50} json ${qq.statusJson.p50} | busy pre p95 ${s.busy.session?.["pre-tool-use"]?.p95} post p95 ${s.busy.session?.["post-tool-batch"]?.p95} | cpu/edit ${cpu.toFixed(2)} s | daemon busy ${s.processProfiles.daemon?.busyMs} ms`,
    );
  }
}
