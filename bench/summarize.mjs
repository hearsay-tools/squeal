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
  {
    id: "hook.preToolUse.p95",
    what: "Hook before each tool call (slowest 5%)",
    unit: "ms",
    healthy: 80,
    warn: 200,
    group: "Hooks",
  },
  {
    id: "hook.postToolBatch.p95",
    what: "Hook after each batch of tool calls (slowest 5%)",
    unit: "ms",
    healthy: 80,
    warn: 200,
    group: "Hooks",
  },
  {
    id: "hook.sessionStart.max",
    what: "Hook at session start (slowest)",
    unit: "ms",
    healthy: 750,
    warn: 2000,
    group: "Hooks",
  },
  {
    id: "hook.stop.max",
    what: "Hook when the agent stops (slowest)",
    unit: "ms",
    healthy: 1500,
    warn: 2000,
    group: "Hooks",
  },
  {
    id: "cmd.status.p95",
    what: "`squeal status` (slowest 5%)",
    unit: "ms",
    healthy: 300,
    warn: 1000,
    group: "Commands",
  },
  {
    id: "cmd.statusJson.p95",
    what: "`squeal status --json` (slowest 5%)",
    unit: "ms",
    healthy: 300,
    warn: 1000,
    group: "Commands",
  },
  {
    id: "cmd.start.main",
    what: "`squeal start` in the main worktree",
    unit: "ms",
    healthy: 2000,
    warn: 5000,
    group: "Commands",
  },
  {
    id: "cmd.start.others.max",
    what: "`squeal start` in another worktree on the shared store",
    unit: "ms",
    healthy: 2000,
    warn: 5000,
    group: "Commands",
  },
  {
    id: "cmd.runAll.overhead",
    what: "Full run with Squeal, as a multiple of plain Vitest",
    unit: "x",
    healthy: 1.3,
    warn: 2,
    group: "Commands",
  },
  { id: "cmd.runAll", what: "Full run with Squeal", unit: "s", group: "Commands" },
  {
    id: "session.pushFail.p50",
    what: "Edit that breaks a test until the agent is told (median)",
    unit: "ms",
    healthy: 3000,
    warn: 10000,
    group: "Verdicts",
  },
  {
    id: "session.pushFail.missed",
    what: "Breaks the agent was never told about",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "session.pushRecovery.missed",
    what: "Fixes the agent was never told about",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "session.verdict.p50",
    what: "Edit until `status --wait` gives a verdict (median)",
    unit: "ms",
    healthy: 3000,
    warn: 10000,
    group: "Verdicts",
  },
  {
    id: "session.verdict.p95",
    what: "Edit until `status --wait` gives a verdict (slowest 5%)",
    unit: "ms",
    healthy: 10000,
    warn: 30000,
    group: "Verdicts",
  },
  {
    id: "session.verdict.within60s",
    what: "Edits with a verdict within the 60 s agents wait",
    unit: "%",
    healthy: 95,
    warn: 80,
    higher: true,
    group: "Verdicts",
  },
  {
    id: "session.verdict.wrong",
    what: "Verdicts that disagree with the truth",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "hook.overTimeout",
    what: "Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "notice.falseAlarm",
    what: "FAIL notices when this session had broken nothing",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "notice.unnamed",
    what: "Failure notices that name neither the edited file nor a test it broke",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "notice.wrongTest",
    what: "FAIL lines for a test the session's break does not reach",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "notice.wrongSession",
    what: "FAIL lines for another worktree's break",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "session.failed",
    what: "Scripted sessions that crashed",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "session.broad.verdict",
    what: "Edit every test imports until the whole suite is current",
    unit: "s",
    healthy: 180,
    warn: 300,
    group: "Verdicts",
  },
  {
    id: "res.idleCpu.maxPct",
    what: "Daemon CPU with no edits",
    unit: "% core",
    healthy: 1,
    warn: 5,
    group: "Resources",
  },
  {
    id: "res.daemonRss.max",
    what: "Daemon memory, peak",
    unit: "MiB",
    healthy: 300,
    warn: 600,
    group: "Resources",
  },
  {
    id: "res.cpuPerEdit",
    what: "Daemon CPU per edit, test runs included",
    unit: "s",
    group: "Resources",
  },
  {
    id: "store.longWrites",
    what: "Store writes that held the lock over 250 ms",
    unit: "",
    healthy: 0,
    warn: 3,
    group: "Store",
  },
  {
    id: "store.lockFailures",
    what: "Store writes that failed on a held lock",
    unit: "",
    healthy: 0,
    warn: 3,
    group: "Store",
  },
  { id: "store.size", what: "Store files on disk", unit: "MiB", group: "Store" },
  { id: "store.results", what: "Result rows in the store", unit: "rows", group: "Store" },
  // Churn cells only: from the daemon's restart on the aged store.
  {
    id: "store.prune.doneMin",
    what: "Restart until a day of expired history is pruned",
    unit: "min",
    healthy: 12,
    warn: 20,
    group: "Store",
  },
  { id: "store.prune.s", what: "Time the prune spent deleting", unit: "s", group: "Store" },
  {
    id: "store.fullCheck.s",
    what: "Restart until the integrity check passed",
    unit: "s",
    group: "Store",
  },
];

const INF = Number.POSITIVE_INFINITY;
/** Every hook in plugins/claude-code/hooks/hooks.json has `timeout: 2`, except the waiters. */
const HOOK_TIMEOUT_MS = 2000;
const maxOrNull = (xs) => (xs.length ? Math.max(...xs) : null);

function cellValues(cellDir) {
  const cell = JSON.parse(readFileSync(join(cellDir, "cell.json"), "utf8"));
  const rows = [];
  for (const f of readdirSync(cellDir).filter((f) => /^session-wt\d+\.jsonl$/.test(f))) {
    const wt = Number(/wt(\d+)/.exec(f)[1]);
    for (const line of readFileSync(join(cellDir, f), "utf8").trim().split("\n"))
      if (line) rows.push({ ...JSON.parse(line), wt });
  }
  const steps = rows.filter((r) => r.kind === "step");
  const by = (type) => steps.filter((s) => s.type === type);
  const v = {
    ...hookValues(rows),
    ...commandValues(cell.phases, by),
    ...verdictValues(by),
    ...resourceValues(cell),
    ...storeValues(cell, cellDir),
    "session.failed": cell.phases.sessions.filter((x) => x.code !== 0).length,
    ...noticeValues(rows, cell.files),
  };
  return { cell, v };
}

const GROUP = 25;
const FAIL_LINE = /(^|\n|-> )FAIL\b/;

/** Module `i` and every module that imports it, directly or not (gen-project.mjs's tree). */
function reach(i, files) {
  const out = new Set([i]);
  const base = i - (i % GROUP);
  for (let j = i + 1; j < Math.min(base + GROUP, files); j++) {
    const parent = base + Math.floor(((j % GROUP) - 1) / 2);
    if (out.has(parent)) out.add(j);
  }
  return out;
}

/**
 * Checks every pushed notice against what the session had broken. A hook row
 * belongs to the step whose row follows it in the session's log; a break holds
 * from its break step to the end of its fix step.
 */
function noticeValues(rows, files) {
  const counts = { falseAlarm: 0, unnamed: 0, wrongTest: 0, wrongSession: 0 };
  const { notices, breaks } = collectNotices(rows, files);
  for (const n of notices) judgeNotice(n, breaks, counts);
  return {
    "notice.falseAlarm": counts.falseAlarm,
    "notice.unnamed": counts.unnamed,
    "notice.wrongTest": counts.wrongTest,
    "notice.wrongSession": counts.wrongSession,
  };
}

/** FAIL notices with the step they came in and the session's open break; every break's interval. */
function collectNotices(rows, files) {
  const notices = [];
  const breaks = [];
  for (const wt of new Set(rows.map((r) => r.wt))) {
    let pending = [];
    let open = null;
    for (const r of rows.filter((x) => x.wt === wt)) {
      if (r.kind === "hook") {
        if (r.hook === "post-tool-batch" && r.text && FAIL_LINE.test(r.text)) pending.push(r);
        continue;
      }
      if (r.kind !== "step") continue;
      if (r.type === "break") {
        const from = pending[0]?.t ?? r.t - r.verdictMs;
        open = { wt, from, set: reach(r.module, files), module: r.module };
      }
      for (const h of pending) notices.push({ wt, t: h.t, step: r, text: h.text, open });
      if (r.type === "fix" && open) {
        breaks.push({ ...open, to: r.t });
        open = null;
      }
      pending = [];
    }
  }
  return { notices, breaks };
}

function judgeNotice(n, breaks, counts) {
  if (!n.open || !["break", "fix"].includes(n.step.type)) {
    counts.falseAlarm++;
    return;
  }
  const failed = [...n.text.matchAll(/(?:^|\n)FAIL\s+test\/m(\d+)\.test\.ts/g)].map((m) =>
    Number(m[1]),
  );
  const names =
    n.text.includes(`src/m${n.open.module}.ts`) || failed.some((k) => n.open.set.has(k));
  if (n.step.type === "break" && !names) counts.unnamed++;
  for (const k of new Set(failed)) {
    if (n.open.set.has(k)) continue;
    const other = breaks.some((b) => b.wt !== n.wt && b.from <= n.t && n.t <= b.to && b.set.has(k));
    if (other) counts.wrongSession++;
    else counts.wrongTest++;
  }
}

function hookValues(rows) {
  const hooks = (name) => rows.filter((r) => r.kind === "hook" && r.hook === name).map((r) => r.ms);
  return {
    "hook.preToolUse.p95": quantile(hooks("pre-tool-use"), 0.95),
    "hook.postToolBatch.p95": quantile(hooks("post-tool-batch"), 0.95),
    "hook.sessionStart.max": maxOrNull(hooks("session-start")),
    "hook.stop.max": maxOrNull(hooks("stop")),
    "hook.overTimeout": rows.filter((r) => r.kind === "hook" && r.ms > HOOK_TIMEOUT_MS).length,
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

/**
 * Churn numbers from prune-watch.json, when the cell wrote one: prune is done
 * when under 1% of the expired backlog is left (aged rows keep expiring while
 * the cell runs, so the count never stays at 0).
 */
function churnFromWatch(cellDir, cell) {
  const file = join(cellDir, "prune-watch.json");
  const start = cell.phases.startAged?.at;
  if (!cell.phases.churn || !existsSync(file) || start === undefined) return cell.phases.churn;
  const series = JSON.parse(readFileSync(file, "utf8")).filter((x) => x.old !== undefined);
  const first = series[0]?.old ?? null;
  const drop = series.find((x) => first !== null && x.old < first);
  const done = series.find((x) => first !== null && x.old <= first / 100);
  return {
    ...cell.phases.churn,
    pruneStartedAfterS: drop ? (drop.t - start) / 1000 : null,
    pruneDoneAfterS: done ? (done.t - start) / 1000 : null,
    pruneS: drop && done ? (done.t - drop.t) / 1000 : null,
  };
}

function storeValues(cell, cellDir) {
  const st = cell.store;
  const churn = churnFromWatch(cellDir, cell);
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
    ? "**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)"
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
const unhealthy = METRICS.filter((m) => !m.gate && m.healthy !== undefined)
  .map((m) => ({
    m,
    cells: names
      .map((n) => ({ n, x: results[n].v[m.id], g: grade(m, results[n].v[m.id]) }))
      .filter((c) => c.g !== null && c.g < 1),
  }))
  .filter((u) => u.cells.length > 0);
lines.push("", "## What is not healthy", "");
if (unhealthy.length === 0) lines.push("Every scored metric is within its healthy limit.");
for (const { m, cells } of unhealthy) {
  const limit = `healthy ${m.higher ? "≥" : "≤"} ${m.healthy} ${m.unit}`.trim();
  const list = cells.map((c) => `${c.n} ${fmt(m, c.x)}${mark(c.g)}`).join(", ");
  lines.push(
    `- **${m.group} · ${m.what}** (${limit}): ${cells.length} of ${names.length} cells: ${list}`,
  );
}
lines.push("", "## Every metric");
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
  lines.push(`| ${m.what} (\`${m.id}\`) | ${healthy} | ${warn} | ${names.map(cell).join(" | ")} |`);
}
console.log(lines.join("\n"));
writeFileSync(
  join(dir, "scores.json"),
  `${JSON.stringify({ meta, correctness: failed.length === 0 ? "pass" : "failed", gateFails, overall, runAreas, scores, areaScores, values: Object.fromEntries(names.map((n) => [n, results[n].v])) }, null, 2)}\n`,
);
