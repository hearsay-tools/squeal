#!/usr/bin/env node
// Turns a results directory into a scorecard (Markdown on stdout) and
// scores.json (see README.md, "Score").
//
// Correctness is a gate: a wrong verdict, a missed push or a failed session
// in any cell marks the run FAILED, whatever its points.
// Speed is scored per area. A metric within its healthy limit scores 1,
// within its warn limit 0.5, beyond it 0. An area's score is the mean of its
// scored metrics; a cell's score is the mean of its areas, so every area
// weighs the same however many metrics it has. The overall score is the mean
// of the cell scores, times 100. "Report" metrics carry no score.
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
  { id: "session.pushFail.p50", unit: "ms", healthy: 3000, warn: 10000, group: "Verdicts" },
  { id: "session.pushFail.missed", unit: "", gate: true, group: "Correctness" },
  { id: "session.pushRecovery.missed", unit: "", gate: true, group: "Correctness" },
  { id: "session.verdict.p50", unit: "ms", healthy: 3000, warn: 10000, group: "Verdicts" },
  { id: "session.verdict.p95", unit: "ms", healthy: 10000, warn: 30000, group: "Verdicts" },
  {
    id: "session.verdict.within60s",
    unit: "%",
    healthy: 95,
    warn: 80,
    higher: true,
    group: "Verdicts",
  },
  { id: "session.verdict.wrong", unit: "", gate: true, group: "Correctness" },
  { id: "session.failed", unit: "", gate: true, group: "Correctness" },
  { id: "session.broad.verdict", unit: "s", healthy: 180, warn: 300, group: "Verdicts" },
  { id: "res.idleCpu.maxPct", unit: "% core", healthy: 1, warn: 5, group: "Resources" },
  { id: "res.daemonRss.max", unit: "MiB", healthy: 300, warn: 600, group: "Resources" },
  { id: "res.cpuPerEdit", unit: "s", group: "Resources" },
  { id: "store.longWrites", unit: "", healthy: 0, warn: 3, group: "Store" },
  { id: "store.lockFailures", unit: "", healthy: 0, warn: 3, group: "Store" },
  { id: "store.size", unit: "MiB", group: "Store" },
  { id: "store.results", unit: "rows", group: "Store" },
  // Churn cells only: from the daemon's restart on the aged store.
  { id: "store.prune.doneMin", unit: "min", healthy: 12, warn: 20, group: "Store" },
  { id: "store.prune.s", unit: "s", group: "Store" },
  { id: "store.fullCheck.s", unit: "s", group: "Store" },
];

const INF = Number.POSITIVE_INFINITY;
const maxOrNull = (xs) => (xs.length ? Math.max(...xs) : null);

function cellValues(cellDir) {
  const cell = JSON.parse(readFileSync(join(cellDir, "cell.json"), "utf8"));
  const rows = [];
  for (const f of readdirSync(cellDir).filter((f) => /^session-wt\d+\.jsonl$/.test(f))) {
    for (const line of readFileSync(join(cellDir, f), "utf8").trim().split("\n"))
      if (line) rows.push(JSON.parse(line));
  }
  const steps = rows.filter((r) => r.kind === "step");
  const by = (type) => steps.filter((s) => s.type === type);
  const v = {
    ...hookValues(rows),
    ...commandValues(cell.phases, by),
    ...verdictValues(by),
    ...resourceValues(cell),
    ...storeValues(cell),
    "session.failed": cell.phases.sessions.filter((x) => x.code !== 0).length,
  };
  return { cell, v };
}

function hookValues(rows) {
  const hooks = (name) => rows.filter((r) => r.kind === "hook" && r.hook === name).map((r) => r.ms);
  return {
    "hook.preToolUse.p95": quantile(hooks("pre-tool-use"), 0.95),
    "hook.postToolBatch.p95": quantile(hooks("post-tool-batch"), 0.95),
    "hook.sessionStart.max": maxOrNull(hooks("session-start")),
    "hook.stop.max": maxOrNull(hooks("stop")),
  };
}

function commandValues(p, by) {
  return {
    "cmd.status.p95": quantile(
      by("status").map((s) => s.statusMs),
      0.95,
    ),
    "cmd.statusJson.p95": quantile(
      by("status").map((s) => s.statusJsonMs),
      0.95,
    ),
    "cmd.start.main": p.startAged?.ms ?? p.startMain?.ms ?? null,
    "cmd.start.others.max": maxOrNull((p.startOthers ?? []).map((s) => s.ms)),
    "cmd.runAll.overhead": p.plainVitest ? p.runAll.ms / p.plainVitest.ms : null,
    "cmd.runAll": p.runAll ? p.runAll.ms / 1000 : null,
  };
}

function verdictValues(by) {
  const edits = [...by("benign"), ...by("break"), ...by("fix")];
  const benign = by("benign").map((s) => (s.late ? INF : s.verdictMs));
  const broad = by("broad");
  return {
    "session.pushFail.p50": quantile(
      by("break").map((s) => s.pushMs ?? INF),
      0.5,
    ),
    "session.pushFail.missed": by("break").filter((s) => !s.pushOk).length,
    "session.pushRecovery.missed": by("fix").filter((s) => !s.pushOk).length,
    "session.verdict.p50": quantile(benign, 0.5),
    "session.verdict.p95": quantile(benign, 0.95),
    "session.verdict.within60s": edits.length
      ? (100 * edits.filter((s) => !s.late).length) / edits.length
      : null,
    "session.verdict.wrong": [...edits, ...broad].filter((s) => s.wrong).length,
    "session.broad.verdict": maxOrNull(broad.map((s) => (s.late ? INF : s.verdictMs / 1000))),
  };
}

function resourceValues(cell) {
  const p = cell.phases;
  const busy = (p.sessionDaemonCpuS ?? []).filter((x) => x !== null);
  return {
    "res.idleCpu.maxPct": maxOrNull((p.idle?.perDaemonCpuPct ?? []).filter((x) => x !== null)),
    "res.daemonRss.max": cell.daemonRss.maxDaemonBytes / 2 ** 20,
    "res.cpuPerEdit": p.edits ? busy.reduce((a, b) => a + b, 0) / p.edits : null,
  };
}

function storeValues(cell) {
  const st = cell.store;
  const churn = cell.phases.churn;
  const doneS = churn?.pruneDoneAfterS ?? null;
  return {
    "store.longWrites": st.longWrites,
    "store.lockFailures": st.lockFailures,
    "store.size": (st.storeBytes + st.walBytes + st.codeBytes) / 2 ** 20,
    "store.results": st.rows?.results ?? null,
    "store.prune.doneMin": churn ? (doneS === null ? INF : doneS / 60) : null,
    "store.prune.s": churn?.pruneS ?? null,
    "store.fullCheck.s": churn?.fullCheckS ?? null,
  };
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
const AREAS = ["Hooks", "Commands", "Verdicts", "Resources", "Store"];
const scores = {};
const areaScores = {};
const gateFails = {};
for (const n of names) {
  const v = results[n].v;
  gateFails[n] = METRICS.filter((m) => m.gate && v[m.id] !== null && v[m.id] > 0).map(
    (m) => `${m.id} ${v[m.id]}`,
  );
  areaScores[n] = {};
  for (const area of AREAS) {
    const gs = METRICS.filter((m) => m.group === area)
      .map((m) => grade(m, v[m.id]))
      .filter((g) => g !== null);
    areaScores[n][area] = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null;
  }
  const present = AREAS.map((a) => areaScores[n][a]).filter((x) => x !== null);
  scores[n] = present.length ? (100 * present.reduce((a, b) => a + b, 0)) / present.length : null;
}
const overall = names.length
  ? names.reduce((a, n) => a + (scores[n] ?? 0), 0) / names.length
  : null;
const failed = names.filter((n) => gateFails[n].length > 0);
/** Per area, the mean over the cells that have it: the run's partial scores. */
const runAreas = Object.fromEntries(
  AREAS.map((a) => {
    const xs = names.map((n) => areaScores[n][a]).filter((x) => x !== null);
    return [a, xs.length ? (100 * xs.reduce((x, y) => x + y, 0)) / xs.length : null];
  }),
);

const lines = [];
lines.push(`# Squeal performance scorecard`, "");
lines.push(
  `Squeal ${meta.squealVersion} · Node ${meta.node} · ${meta.cpuModel} · ${meta.vcpus} vCPU · ${meta.memGiB} GiB · SHA-256 ${Math.round(Math.max(...meta.sha256MiBPerS))} MiB/s · ${meta.startedAt}`,
  "",
);
lines.push(
  failed.length === 0
    ? "**Correctness: PASS** (no wrong verdict, missed push or failed session in any cell)"
    : `**Correctness: FAILED** in ${failed.map((n) => `${n} (${gateFails[n].join(", ")})`).join("; ")}`,
  "",
  `**Overall score: ${overall?.toFixed(0)} / 100** (mean of the cell scores; a cell is the mean of its ${AREAS.length} areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)`,
  "",
);
lines.push(
  `| Area | ${AREAS.join(" | ")} |`,
  `|---|${AREAS.map(() => "---:").join("|")}|`,
  `| All cells | ${AREAS.map((a) => runAreas[a]?.toFixed(0) ?? "n/a").join(" | ")} |`,
  "",
);
lines.push(
  `| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | ${AREAS.join(" | ")} |`,
  `|---|---:|---:|---:|---:|---|---:|${AREAS.map(() => "---:").join("|")}|`,
);
for (const n of names) {
  const c = results[n].cell;
  const area = (a) => (areaScores[n][a] === null ? "n/a" : (100 * areaScores[n][a]).toFixed(0));
  lines.push(
    `| ${n} | ${c.files} | ${c.worktrees} | ${c.load}% | ${c.ageRounds ?? 0}${c.churn ? " churn" : ""} | ${gateFails[n].length ? "❌" : "✅"} | ${scores[n]?.toFixed(0)} | ${AREAS.map(area).join(" | ")} |`,
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
  const cell = (n) => {
    const x = results[n].v[m.id];
    if (m.gate) return x === null ? "n/a" : `${x}${x > 0 ? " ❌" : " ✅"}`;
    return fmt(m, x) + mark(grade(m, x));
  };
  const healthy = m.gate ? "0 (gate)" : lim(m.healthy);
  const warn = m.gate || m.healthy === undefined ? "" : lim(m.warn);
  lines.push(`| ${m.id} | ${healthy} | ${warn} | ${names.map(cell).join(" | ")} |`);
}
console.log(lines.join("\n"));
writeFileSync(
  join(dir, "scores.json"),
  `${JSON.stringify({ meta, correctness: failed.length === 0 ? "pass" : "failed", gateFails, overall, runAreas, scores, areaScores, values: Object.fromEntries(names.map((n) => [n, results[n].v])) }, null, 2)}\n`,
);
