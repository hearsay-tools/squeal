#!/usr/bin/env node
// Turns a results directory into a scorecard (Markdown on stdout) and
// scores.json. Each metric has a healthy and a warn limit (see README.md,
// "Metrics"): healthy scores 1, warn 0.5, fail 0. A cell's score is the mean
// over its scored metrics, times 100. "Report" metrics carry no score.
//
// Usage: node summarize.mjs <results dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { quantile } from "./lib.mjs";

const dir = process.argv[2];
const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));

/** lower is better unless `higher`. */
export const METRICS = [
  { id: "hook.preToolUse.p95", unit: "ms", healthy: 80, warn: 200, group: "Hooks" },
  { id: "hook.postToolBatch.p95", unit: "ms", healthy: 80, warn: 200, group: "Hooks" },
  { id: "hook.sessionStart.max", unit: "ms", healthy: 750, warn: 2000, group: "Hooks" },
  { id: "hook.stop.max", unit: "ms", healthy: 1500, warn: 2000, group: "Hooks" },
  { id: "cmd.status.p95", unit: "ms", healthy: 300, warn: 1000, group: "Commands" },
  { id: "cmd.statusJson.p95", unit: "ms", healthy: 300, warn: 1000, group: "Commands" },
  { id: "cmd.start.main", unit: "ms", healthy: 2000, warn: 5000, group: "Commands" },
  { id: "cmd.start.others.max", unit: "ms", healthy: 2000, warn: 5000, group: "Commands" },
  { id: "cmd.runAll.overhead", unit: "x", healthy: 1.3, warn: 2, group: "Commands" },
  { id: "cmd.runAll", unit: "s", group: "Commands" },
  { id: "session.pushFail.p50", unit: "ms", healthy: 3000, warn: 10000, group: "Session" },
  { id: "session.pushFail.missed", unit: "", healthy: 0, warn: 0, group: "Session" },
  { id: "session.pushRecovery.missed", unit: "", healthy: 0, warn: 0, group: "Session" },
  { id: "session.verdict.p50", unit: "ms", healthy: 3000, warn: 10000, group: "Session" },
  { id: "session.verdict.p95", unit: "ms", healthy: 10000, warn: 30000, group: "Session" },
  {
    id: "session.verdict.within60s",
    unit: "%",
    healthy: 95,
    warn: 80,
    higher: true,
    group: "Session",
  },
  { id: "session.verdict.wrong", unit: "", healthy: 0, warn: 0, group: "Session" },
  { id: "session.broad.verdict", unit: "s", healthy: 180, warn: 300, group: "Session" },
  { id: "res.idleCpu.maxPct", unit: "% core", healthy: 1, warn: 5, group: "Resources" },
  { id: "res.daemonRss.max", unit: "MiB", healthy: 300, warn: 600, group: "Resources" },
  { id: "res.cpuPerEdit", unit: "s", group: "Resources" },
  { id: "store.longWrites", unit: "", healthy: 0, warn: 3, group: "Store" },
  { id: "store.lockFailures", unit: "", healthy: 0, warn: 3, group: "Store" },
  { id: "store.size", unit: "MiB", group: "Store" },
  { id: "store.results", unit: "rows", group: "Store" },
];

function cellValues(cellDir) {
  const cell = JSON.parse(readFileSync(join(cellDir, "cell.json"), "utf8"));
  const rows = [];
  for (const f of readdirSync(cellDir).filter((f) => /^session-wt\d+\.jsonl$/.test(f))) {
    for (const line of readFileSync(join(cellDir, f), "utf8").trim().split("\n"))
      if (line) rows.push(JSON.parse(line));
  }
  const hooks = (name) => rows.filter((r) => r.kind === "hook" && r.hook === name).map((r) => r.ms);
  const steps = rows.filter((r) => r.kind === "step");
  const by = (type) => steps.filter((s) => s.type === type);
  const edits = steps.filter((s) => ["benign", "break", "fix"].includes(s.type));
  const settledBenign = by("benign")
    .filter((s) => !s.late)
    .map((s) => s.verdictMs);
  const benignAll = by("benign").map((s) => (s.late ? Number.POSITIVE_INFINITY : s.verdictMs));
  const broad = by("broad");
  const p = cell.phases;
  const v = {
    "hook.preToolUse.p95": quantile(hooks("pre-tool-use"), 0.95),
    "hook.postToolBatch.p95": quantile(hooks("post-tool-batch"), 0.95),
    "hook.sessionStart.max": Math.max(...hooks("session-start")),
    "hook.stop.max": Math.max(...hooks("stop")),
    "cmd.status.p95": quantile(
      by("status").map((s) => s.statusMs),
      0.95,
    ),
    "cmd.statusJson.p95": quantile(
      by("status").map((s) => s.statusJsonMs),
      0.95,
    ),
    "cmd.start.main": p.startAged?.ms ?? p.startMain?.ms ?? null,
    "cmd.start.others.max": p.startOthers?.length
      ? Math.max(...p.startOthers.map((s) => s.ms))
      : null,
    "cmd.runAll.overhead": p.plainVitest ? p.runAll.ms / p.plainVitest.ms : null,
    "cmd.runAll": p.runAll ? p.runAll.ms / 1000 : null,
    "session.pushFail.p50": quantile(
      by("break").map((s) => s.pushMs ?? Number.POSITIVE_INFINITY),
      0.5,
    ),
    "session.pushFail.missed": by("break").filter((s) => !s.pushOk).length,
    "session.pushRecovery.missed": by("fix").filter((s) => !s.pushOk).length,
    "session.verdict.p50": quantile(benignAll, 0.5),
    "session.verdict.p95": quantile(benignAll, 0.95),
    "session.verdict.within60s": edits.length
      ? (100 * edits.filter((s) => !s.late).length) / edits.length
      : null,
    "session.verdict.wrong":
      edits.filter((s) => s.wrong).length + broad.filter((s) => s.wrong).length,
    "session.broad.verdict": broad.length
      ? Math.max(...broad.map((s) => (s.late ? Number.POSITIVE_INFINITY : s.verdictMs / 1000)))
      : null,
    "res.idleCpu.maxPct": p.idle?.perDaemonCpuPct?.length
      ? Math.max(...p.idle.perDaemonCpuPct.filter((x) => x !== null))
      : null,
    "res.daemonRss.max": cell.daemonRss.maxDaemonBytes / 2 ** 20,
    "res.cpuPerEdit": p.edits
      ? p.sessionDaemonCpuS.filter((x) => x !== null).reduce((a, b) => a + b, 0) / p.edits
      : null,
    "store.longWrites": cell.store.longWrites,
    "store.lockFailures": cell.store.lockFailures,
    "store.size": (cell.store.storeBytes + cell.store.walBytes + cell.store.codeBytes) / 2 ** 20,
    "store.results": cell.store.rows?.results ?? null,
  };
  return { cell, v, settledBenign, sessionsFailed: p.sessions.filter((s) => s.code !== 0).length };
}

function grade(m, x) {
  if (m.healthy === undefined || x === null || Number.isNaN(x)) return null;
  if (m.higher) return x >= m.healthy ? 1 : x >= m.warn ? 0.5 : 0;
  return x <= m.healthy ? 1 : x <= m.warn ? 0.5 : 0;
}
const fmt = (m, x) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  if (x === Number.POSITIVE_INFINITY) return "late";
  const d = m.unit === "x" ? 2 : Math.abs(x) < 10 && !Number.isInteger(x) ? 1 : 0;
  return `${x.toFixed(d)}${m.unit && m.unit !== "rows" ? ` ${m.unit}` : ""}`;
};
const mark = (g) => (g === null ? "" : g === 1 ? " ✅" : g === 0.5 ? " ⚠️" : " ❌");

const cellsDir = join(dir, "cells");
const names = meta.cells
  .map((c) => c.name)
  .filter((n) => existsSync(join(cellsDir, n, "cell.json")));
const results = Object.fromEntries(names.map((n) => [n, cellValues(join(cellsDir, n))]));
const scores = {};
for (const n of names) {
  const gs = METRICS.map((m) => grade(m, results[n].v[m.id])).filter((g) => g !== null);
  scores[n] = gs.length ? (100 * gs.reduce((a, b) => a + b, 0)) / gs.length : null;
}
const overall = names.length
  ? names.reduce((a, n) => a + (scores[n] ?? 0), 0) / names.length
  : null;

const lines = [];
lines.push(`# Squeal performance scorecard`, "");
lines.push(
  `Squeal ${meta.squealVersion} · Node ${meta.node} · ${meta.cpuModel} · ${meta.vcpus} vCPU · ${meta.memGiB} GiB · SHA-256 ${Math.round(Math.max(...meta.sha256MiBPerS))} MiB/s · ${meta.startedAt}`,
  "",
);
lines.push(
  `**Overall score: ${overall?.toFixed(0)} / 100** (mean of the cell scores; healthy 1, warn 0.5, fail 0 per metric)`,
  "",
);
lines.push(
  `| Cell | Files | Worktrees | Load | Aged rounds | Score | Sessions failed |`,
  `|---|---:|---:|---:|---:|---:|---:|`,
);
for (const n of names) {
  const c = results[n].cell;
  lines.push(
    `| ${n} | ${c.files} | ${c.worktrees} | ${c.load}% | ${c.ageRounds ?? 0} | ${scores[n]?.toFixed(0)} | ${results[n].sessionsFailed} |`,
  );
}
lines.push(
  "",
  `| Metric | Healthy | Warn | ${names.join(" | ")} |`,
  `|---|---:|---:|${names.map(() => "---:").join("|")}|`,
);
let group = "";
for (const m of METRICS) {
  if (m.group !== group) {
    group = m.group;
    lines.push(`| **${group}** | | | ${names.map(() => "").join(" | ")} |`);
  }
  const lim = (x) => (x === undefined ? "report" : `${m.higher ? "≥" : "≤"} ${x}`);
  lines.push(
    `| ${m.id} | ${lim(m.healthy)} | ${m.healthy === undefined ? "" : lim(m.warn)} | ${names.map((n) => fmt(m, results[n].v[m.id]) + mark(grade(m, results[n].v[m.id]))).join(" | ")} |`,
  );
}
console.log(lines.join("\n"));
writeFileSync(
  join(dir, "scores.json"),
  `${JSON.stringify({ meta, overall, scores, values: Object.fromEntries(names.map((n) => [n, results[n].v])) }, null, 2)}\n`,
);
