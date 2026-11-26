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
// Imported (tests), it runs nothing: `summarize(dir)` does the work and returns the scores.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hookWriteWaitLog, longWriteHolds, quantile } from "./lib.mjs";

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
  // Row 025-08: the tails behind the p95s, and how long hook writes waited for the daemon's
  // main thread (spec 025 D9; n/a for a Squeal version that does not log them).
  {
    id: "hook.preToolUse.p99",
    what: "Hook before each tool call (slowest 1%)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.preToolUse.max",
    what: "Hook before each tool call (slowest)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.postToolBatch.p99",
    what: "Hook after each batch of tool calls (slowest 1%)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.postToolBatch.max",
    what: "Hook after each batch of tool calls (slowest)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.writeWait.p95",
    what: "Hook write wait for the daemon main thread (highest per-minute p95)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.writeWait.max",
    what: "Hook write wait for the daemon main thread (longest)",
    unit: "ms",
    group: "Hooks",
  },
  {
    id: "hook.longWriteWaits",
    what: "Hook writes that waited over 250 ms for the daemon main thread",
    unit: "",
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
    id: "store.failedBatches",
    what: "Code-store batches reported failed, by the store process or a daemon (lost writes)",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "cell.setupFailed",
    what: "Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing",
    unit: "",
    gate: true,
    group: "Correctness",
  },
  {
    id: "ff.gitFailed",
    what: "Fast-forward or rebase that git refused, so the cell measured no fast-forward",
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
  // Issue 261 (ff cells): the agent brings in a commit that changes 125 of 500 modules.
  {
    id: "ff.queued",
    what: "Fast-forward: test files queued 3 s after it",
    unit: "",
    group: "Verdicts",
  },
  {
    id: "ff.import.s",
    what: "Fast-forward from CI: `squeal import` of the export",
    unit: "s",
    group: "Verdicts",
  },
  {
    id: "ff.drainS",
    what: "Fast-forward: until no test file waits (polled before each later step)",
    unit: "s",
    healthy: 120,
    warn: 600,
    group: "Verdicts",
  },
  {
    id: "ff.lateNotices",
    what: "Fast-forward: hook outputs after it that report its files as not run yet",
    unit: "",
    healthy: 0,
    warn: 3,
    group: "Verdicts",
  },
  {
    id: "ff.editVerdict.p50",
    what: "Fast-forward: the agent's own edits after it until their verdict (median)",
    unit: "ms",
    healthy: 3000,
    warn: 10000,
    group: "Verdicts",
  },
  {
    id: "res.idleCpu.maxPct",
    what: "CPU with no edits: the busiest daemon, plus the store process",
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
    // Row 025-08: the daemon with its test runners and other children, per worktree (the peak
    // of all daemon trees together, divided by the worktrees), so wt-3 and ref compare.
    id: "res.treeRss.max",
    what: "Daemon with its test runs, memory per worktree, peak",
    unit: "MiB",
    healthy: 1200,
    warn: 2400,
    group: "Resources",
  },
  {
    id: "res.cpuPerEdit",
    what: "CPU per edit: daemons with their test runs, plus the store process",
    unit: "s",
    group: "Resources",
  },
  {
    id: "res.storeProcess.cpuS",
    what: "Store process CPU during the sessions",
    unit: "s",
    group: "Resources",
  },
  {
    id: "res.storeProcess.rss",
    what: "Store process memory, peak",
    unit: "MiB",
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
  {
    id: "store.process.queueWaitMax",
    what: "Store process: longest wait of a batch in its queue",
    unit: "ms",
    group: "Store",
  },
  {
    id: "store.process.busy",
    what: "Store process: time spent writing",
    unit: "s",
    group: "Store",
  },
  {
    id: "store.process.direct",
    what: "Code-store batches a daemon wrote itself because the store process was gone",
    unit: "",
    group: "Store",
  },
  { id: "store.process.stops", what: "Store process: times it stopped", unit: "", group: "Store" },
  {
    id: "cmd.impact.s",
    what: "`squeal impact` (reads every stored module list)",
    unit: "s",
    group: "Commands",
  },
  { id: "res.impact.rss", what: "`squeal impact` memory, peak", unit: "MiB", group: "Resources" },
  {
    id: "store.longWrite.maxMs",
    what: "Longest logged lock hold (only holds over 250 ms are logged)",
    unit: "ms",
    group: "Store",
  },
  { id: "store.longWrite.totalS", what: "Logged lock holds, total", unit: "s", group: "Store" },
];

const INF = Number.POSITIVE_INFINITY;
/** Every hook in plugins/claude-code/hooks/hooks.json has `timeout: 2`, except the waiters. */
const HOOK_TIMEOUT_MS = 2000;
const maxOrNull = (xs) => (xs.length ? Math.max(...xs) : null);

export function cellValues(cellDir) {
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
    ...writeWaitValues(cell, cellDir),
    ...commandValues(cell.phases, by),
    ...verdictValues(by),
    ...resourceValues(cell),
    ...storeValues(cell, cellDir),
    "session.failed": cell.phases.sessions.filter((x) => x.code !== 0).length,
    "cell.setupFailed": setupFailures(cell.phases),
    ...noticeValues(rows, cell.files),
    ...ffValues(rows),
    "ff.import.s": cell.phases.upstream?.ci ? cell.phases.upstream.ci.import.ms / 1000 : null,
  };
  return { cell, v };
}

/** Setup steps that failed: a cell whose project never ran its tests measured nothing. */
function setupFailures(p) {
  let n = 0;
  if (p.plainVitest && p.plainVitest.code !== 0) n++;
  if (p.runAll && p.runAll.code !== 0) n++;
  // `age.code` was the code store's numbers in runs before 2026-11-21; only a number is an exit code.
  if (p.age && (p.age.err || (typeof p.age.code === "number" && p.age.code !== 0))) n++;
  // ff-ci: a CI record (the tests' own exit code), export or import that failed.
  const ci = p.upstream?.ci;
  if (ci) n += [ci.record, ci.export, ci.import].filter((x) => x.code !== 0).length;
  return n;
}

/** Issue 261's numbers, from the session that made the fast-forward (worktree 0); null without one. */
function ffValues(rows) {
  const own = rows.filter((r) => r.wt === 0);
  const at = own.findIndex((r) => r.kind === "step" && r.type === "ff");
  if (at === -1) {
    return {
      "ff.queued": null,
      "ff.drainS": null,
      "ff.lateNotices": null,
      "ff.editVerdict.p50": null,
      "ff.gitFailed": null,
    };
  }
  const ff = own[at];
  const after = own.slice(at + 1);
  const drained = after.find((r) => r.kind === "ff-poll" && r.pending === 0);
  const quiet = after.find((r) => r.kind === "ff-quiet");
  let drainS = INF;
  if (drained) drainS = drained.sinceFfMs / 1000;
  else if (quiet?.outcome === "settled") drainS = quiet.sinceFfMs / 1000;
  // Notices about the fast-forward's files: "N of the M test files your edits affect have not
  // run" where M covers what it queued. Notices about the agent's own few edits do not count.
  const queued = ff.testFiles?.pending ?? 0;
  const late = after.filter((r) => {
    if (r.kind !== "hook" || r.hook !== "post-tool-batch" || !r.text || queued === 0) return false;
    const m = /(\d+) of the (\d+) test files/.exec(r.text);
    return m !== null && Number(m[1]) > 0 && Number(m[2]) >= 0.9 * queued;
  }).length;
  const verdicts = after
    .filter((r) => r.kind === "step" && r.type === "benign")
    .map((r) => (r.late ? INF : r.verdictMs));
  return {
    "ff.queued": ff.testFiles?.pending ?? null,
    "ff.drainS": drainS,
    "ff.lateNotices": late,
    "ff.editVerdict.p50": quantile(verdicts, 0.5),
    "ff.gitFailed": ff.gitCode === 0 ? 0 : 1,
  };
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

export function hookValues(rows) {
  const hooks = (name) => rows.filter((r) => r.kind === "hook" && r.hook === name).map((r) => r.ms);
  return {
    "hook.preToolUse.p95": quantile(hooks("pre-tool-use"), 0.95),
    "hook.preToolUse.p99": quantile(hooks("pre-tool-use"), 0.99),
    "hook.preToolUse.max": maxOrNull(hooks("pre-tool-use")),
    "hook.postToolBatch.p95": quantile(hooks("post-tool-batch"), 0.95),
    "hook.postToolBatch.p99": quantile(hooks("post-tool-batch"), 0.99),
    "hook.postToolBatch.max": maxOrNull(hooks("post-tool-batch")),
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

/**
 * Spec 025 D9's hook write waits: saved by the cell, or read from its copied daemon logs for a
 * run made before row 025-08. Null when no log line names them (a Squeal version before D9).
 */
export function writeWaitValues(cell, cellDir) {
  let w = cell.hookWriteWait;
  const logs = join(cellDir, "logs");
  if (!w && existsSync(logs)) {
    const text = readdirSync(logs)
      .filter((f) => !f.startsWith("store-"))
      .map((f) => readFileSync(join(logs, f), "utf8"))
      .join("\n");
    w = hookWriteWaitLog(text);
  }
  const seen = Boolean(w?.seen);
  return {
    "hook.writeWait.p95": seen ? w.p95MaxMs : null,
    "hook.writeWait.max": seen ? w.maxMs : null,
    "hook.longWriteWaits": seen ? w.longWaitsMs.length : null,
  };
}

export function resourceValues(cell) {
  const p = cell.phases;
  const busy = (p.sessionDaemonCpuS ?? []).filter((x) => x !== null);
  const storeCpu = p.sessionStoreProcessCpuS ?? 0;
  const idle = maxOrNull((p.idle?.perDaemonCpuPct ?? []).filter((x) => x !== null));
  const sp = cell.storeProcess;
  return {
    "res.idleCpu.maxPct": idle === null ? null : idle + (p.idle?.storeProcessCpuPct ?? 0),
    "res.daemonRss.max": cell.daemonRss.maxDaemonBytes / 2 ** 20,
    "res.treeRss.max": cell.daemonRss.maxTreeBytes
      ? cell.daemonRss.maxTreeBytes / Math.max(1, cell.worktrees ?? 1) / 2 ** 20
      : null,
    "res.cpuPerEdit": p.edits ? (busy.reduce((a, b) => a + b, 0) + storeCpu) / p.edits : null,
    "res.storeProcess.cpuS": sp?.seen ? storeCpu : null,
    "res.storeProcess.rss": sp?.seen ? sp.maxRssBytes / 2 ** 20 : null,
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

/** Logged lock holds: saved by the cell, or read from its copied logs for a run made before that. */
function holdsOf(cell, cellDir) {
  if (cell.store.longWriteHoldsMs) return cell.store.longWriteHoldsMs;
  const dir = join(cellDir, "logs");
  if (!existsSync(dir)) return null;
  return readdirSync(dir).flatMap((f) => longWriteHolds(readFileSync(join(dir, f), "utf8")));
}

function storeValues(cell, cellDir) {
  const st = cell.store;
  const holds = holdsOf(cell, cellDir);
  const churn = churnFromWatch(cellDir, cell);
  const doneS = churn?.pruneDoneAfterS ?? null;
  // Runs before spec 015 D11's 2026-11-22 rename saved the same timing as `phases.reach`.
  const impact = cell.phases.impact ?? cell.phases.reach;
  return {
    "store.longWrites": st.longWrites,
    "store.lockFailures": st.lockFailures,
    "store.size": (st.storeBytes + st.walBytes + st.codeBytes) / 2 ** 20,
    "store.results": st.rows?.results ?? null,
    "store.prune.doneMin": churn ? (doneS === null ? INF : doneS / 60) : null,
    "store.prune.s": churn?.pruneS ?? null,
    "store.fullCheck.s": churn?.fullCheckS ?? null,
    "store.longWrite.maxMs": holds ? maxOrNull(holds) : null,
    "store.longWrite.totalS": holds ? holds.reduce((a, b) => a + b, 0) / 1000 : null,
    "cmd.impact.s": impact ? impact.ms / 1000 : null,
    "res.impact.rss": impact ? impact.peakRssBytes / 2 ** 20 : null,
    ...storeProcessValues(cell.storeProcess),
  };
}

/** Spec 021 D22's numbers; null for a Squeal version with no store process. */
function storeProcessValues(sp) {
  const seen = Boolean(sp?.seen || sp?.written || sp?.relay?.sent);
  return {
    "store.failedBatches": sp ? sp.failed + sp.failedLines + (sp.relay?.failed ?? 0) : null,
    "store.process.queueWaitMax": seen ? sp.queueWaitMaxMs : null,
    "store.process.busy": seen ? sp.busyMs / 1000 : null,
    "store.process.direct": seen ? (sp.relay?.direct ?? 0) : null,
    "store.process.stops": seen ? sp.stops : null,
  };
}

export function grade(m, x) {
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

/** Raw numbers the comparison shows for each cell: the ones a change to the store or the hooks moves. */
const RAW = [
  "hook.preToolUse.p95",
  "hook.postToolBatch.p95",
  "hook.preToolUse.p99",
  "hook.postToolBatch.p99",
  "hook.writeWait.max",
  "hook.longWriteWaits",
  "hook.sessionStart.max",
  "cmd.status.p95",
  "ff.queued",
  "ff.drainS",
  "ff.lateNotices",
  "ff.editVerdict.p50",
  "session.pushFail.p50",
  "session.verdict.within60s",
  "res.idleCpu.maxPct",
  "res.cpuPerEdit",
  "res.daemonRss.max",
  "res.treeRss.max",
  "res.storeProcess.rss",
  "store.longWrites",
  "store.longWrite.maxMs",
  "store.longWrite.totalS",
  "cmd.impact.s",
  "res.impact.rss",
];
const AREAS = ["Hooks", "Commands", "Verdicts", "Resources", "Store"];

/** Writes scores.json into `dir`; returns the scorecard's Markdown and the scores. */
export function summarize(dir) {
  const run = scoreRun(dir);
  const { meta, names, results, failed, gateFails, overall, runAreas, scores, areaScores } = run;
  const values = Object.fromEntries(names.map((n) => [n, results[n].v]));
  writeFileSync(
    join(dir, "scores.json"),
    `${JSON.stringify({ meta, correctness: failed.length === 0 ? "pass" : "failed", gateFails, overall, runAreas, scores, areaScores, values }, null, 2)}\n`,
  );
  const lines = [...headerLines(run)];
  if (run.pluginOrder.length > 1 || (meta.repeat ?? 1) > 1) lines.push(...comparison(run));
  lines.push(...unhealthyLines(run), ...settleLines(run), ...metricLines(run));
  return { scorecard: lines.join("\n"), overall, scores, areaScores, gateFails, values };
}

/** Every cell's values, its gate failures and its scores per area. */
function scoreRun(dir) {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const cellsDir = join(dir, "cells");
  // A paired run (several plugins) lists each cell's versions side by side, in the plugins' order.
  const pluginOrder = (meta.plugins ?? []).map((p) => p.label);
  const names = [...meta.cells]
    .sort((a, b) =>
      a.base === b.base
        ? pluginOrder.indexOf(a.plugin) - pluginOrder.indexOf(b.plugin) ||
          (a.rep ?? 1) - (b.rep ?? 1)
        : 0,
    )
    .map((c) => c.name)
    .filter((n) => existsSync(join(cellsDir, n, "cell.json")));
  const results = Object.fromEntries(names.map((n) => [n, cellValues(join(cellsDir, n))]));
  const scores = {};
  const areaScores = {};
  const gateFails = {};
  for (const n of names) {
    const v = results[n].v;
    gateFails[n] = METRICS.filter((m) => m.gate && v[m.id] !== null && v[m.id] > 0).map(
      (m) => `${m.id} ${v[m.id]}`,
    );
    areaScores[n] = Object.fromEntries(AREAS.map((area) => [area, areaScore(area, v)]));
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
  return {
    meta,
    pluginOrder,
    names,
    results,
    scores,
    areaScores,
    gateFails,
    overall,
    failed,
    runAreas,
  };
}

function areaScore(area, v) {
  const gs = METRICS.filter((m) => m.group === area)
    .map((m) => grade(m, v[m.id]))
    .filter((g) => g !== null);
  return gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null;
}

function headerLines({
  meta,
  names,
  results,
  scores,
  areaScores,
  gateFails,
  overall,
  failed,
  runAreas,
}) {
  const lines = [];
  lines.push(`# Squeal performance scorecard`, "");
  lines.push(
    `Squeal ${meta.squealVersion} · Node ${meta.node}${depsText(meta)} · ${meta.cpuModel} · ${meta.vcpus} vCPU · ${meta.memGiB} GiB · SHA-256 ${Math.round(Math.max(...meta.sha256MiBPerS))} MiB/s · ${meta.startedAt}`,
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
  return lines;
}

/**
 * Row 025-13: why a cell's idle figures may include start-up work: a secondary worktree whose
 * baseline did not settle in time (what it still waited for), or a store process that did not go
 * quiet; and whether the CLI ran through the plugin's bin/squeal. Empty for a cell from before.
 */
/**
 * The installed test dependencies for the header line (row 025-24): ` · Vitest 5.0.3 · Vite 8.4.0 ·
 * coverage-v8 5.0.3`. Templates that installed different versions show each set, split by ` / `.
 * Empty for runs recorded before meta.json kept them.
 */
export function depsText(meta) {
  const sets = Object.values(meta.deps ?? {}).map(
    (d) =>
      `Vitest ${d.vitest ?? "?"} · Vite ${d.vite ?? "?"} · coverage-v8 ${d["@vitest/coverage-v8"] ?? "?"}`,
  );
  const distinct = [...new Set(sets)];
  return distinct.length === 0 ? "" : ` · ${distinct.join(" / ")}`;
}

export function idleSettleIssues(cell) {
  const issues = [];
  for (const [i, s] of (cell.phases?.startOthers ?? []).entries()) {
    if (s.settle && !s.settle.settled)
      issues.push(`wt${i + 1} baseline not settled (${s.settle.waitingFor ?? "unknown"})`);
  }
  const quiet = cell.phases?.storeQuiet;
  if (quiet && !quiet.settled)
    issues.push(`store process not quiet (${quiet.lastPct?.toFixed(1) ?? "n/a"}% CPU)`);
  if (cell.cli === "bundle") issues.push("CLI ran from its bundle, not bin/squeal");
  return issues;
}

function settleLines({ names, results }) {
  const cells = names
    .map((n) => ({ n, issues: idleSettleIssues(results[n].cell) }))
    .filter((c) => c.issues.length > 0);
  const lines = ["", "## Before the idle minute", ""];
  if (cells.length === 0)
    lines.push("Every cell's baselines and store process settled before its idle minute.");
  for (const { n, issues } of cells) lines.push(`- ${n}: ${issues.join("; ")}`);
  return lines;
}

function unhealthyLines({ names, results }) {
  const unhealthy = METRICS.filter((m) => !m.gate && m.healthy !== undefined)
    .map((m) => ({
      m,
      cells: names
        .map((n) => ({ n, x: results[n].v[m.id], g: grade(m, results[n].v[m.id]) }))
        .filter((c) => c.g !== null && c.g < 1),
    }))
    .filter((u) => u.cells.length > 0);
  const lines = ["", "## What is not healthy", ""];
  if (unhealthy.length === 0) lines.push("Every scored metric is within its healthy limit.");
  for (const { m, cells } of unhealthy) {
    const limit = `healthy ${m.higher ? "≥" : "≤"} ${m.healthy} ${m.unit}`.trim();
    const list = cells.map((c) => `${c.n} ${fmt(m, c.x)}${mark(c.g)}`).join(", ");
    lines.push(
      `- **${m.group} · ${m.what}** (${limit}): ${cells.length} of ${names.length} cells: ${list}`,
    );
  }
  return lines;
}

function metricLines({ names, results }) {
  const lines = ["", "## Every metric"];
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
    lines.push(
      `| ${m.what} (\`${m.id}\`) | ${healthy} | ${warn} | ${names.map(cell).join(" | ")} |`,
    );
  }
  return lines;
}

/**
 * Paired or repeated runs: per cell and version, the mean score (with its
 * range when repeated), the change of the mean against the first version, and
 * the mean of the raw numbers in `RAW`, so a change too small to move a score
 * band still shows.
 */
function comparison(run) {
  const { meta, pluginOrder } = run;
  const labels = pluginOrder.length ? pluginOrder : [undefined];
  const bases = [...new Set(meta.cells.map((c) => c.base ?? c.name))];
  const title =
    labels.length > 1
      ? `${labels[0]} compared with ${labels.slice(1).join(", ")} (same machine, cells alternated)`
      : "Repeats";
  const out = ["", `## ${title}`, ""];
  out.push(
    `| Cell | Version | Runs | Correct | Score (range) | Δ | ${AREAS.map((a) => `${a} Δ`).join(" | ")} |`,
  );
  out.push(`|---|---|---:|---|---:|---:|${AREAS.map(() => "---:").join("|")}|`);
  const raw = ["", "Raw numbers, mean per cell and version (Δ% against the first version):", ""];
  raw.push(
    `| Cell | Metric | ${labels.map((l) => l ?? "value").join(" | ")}${labels.length > 1 ? " | Δ%" : ""} |`,
  );
  raw.push(`|---|---|${labels.map(() => "---:").join("|")}${labels.length > 1 ? "|---:" : ""}|`);
  for (const base of bases) {
    if (runsOf(run, base, labels[0]).length === 0) continue;
    for (const label of labels) {
      const row = scoreRow(run, base, label, labels[0]);
      if (row) out.push(row);
    }
    raw.push(...rawRows(run, base, labels));
  }
  return [...out, ...raw];
}

function runsOf({ meta, results }, base, label) {
  return meta.cells
    .filter((c) => (c.base ?? c.name) === base && c.plugin === label && results[c.name])
    .map((c) => c.name);
}

function meanOf(xs) {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function signed(d) {
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}`;
}

function scoreRow(run, base, label, first) {
  const { scores, areaScores, gateFails } = run;
  const ns = runsOf(run, base, label);
  if (ns.length === 0) return null;
  const firstRuns = runsOf(run, base, first);
  const sc = ns.map((n) => scores[n]).filter((x) => x !== null);
  const m = meanOf(sc);
  const firstScore = meanOf(firstRuns.map((n) => scores[n]));
  const range =
    sc.length > 1 ? ` (${Math.min(...sc).toFixed(0)}–${Math.max(...sc).toFixed(0)})` : "";
  const isFirst = label === first;
  const d = isFirst || m === null || firstScore === null ? "" : signed(m - firstScore);
  const areas = AREAS.map((a) => {
    const x = meanOf(ns.map((n) => areaScores[n][a]));
    const f = meanOf(firstRuns.map((n) => areaScores[n][a]));
    return isFirst || x === null || f === null ? "" : signed(100 * (x - f));
  });
  const correct = ns.every((n) => gateFails[n].length === 0) ? "✅" : "❌";
  return `| ${base} | ${label ?? ""} | ${ns.length} | ${correct} | ${m?.toFixed(0) ?? "n/a"}${range} | ${d} | ${areas.join(" | ")} |`;
}

function rawRows(run, base, labels) {
  const rows = [];
  for (const id of RAW) {
    const m = METRICS.find((x) => x.id === id);
    const vals = labels.map((l) => meanOf(runsOf(run, base, l).map((n) => run.results[n].v[id])));
    if (vals.every((x) => x === null)) continue;
    let pct = "";
    if (labels.length > 1)
      pct =
        vals[0] && vals[1] !== null
          ? ` | ${signed((100 * (vals[1] - vals[0])) / vals[0])}%`
          : " | ";
    rows.push(`| ${base} | ${m.what} | ${vals.map((x) => fmt(m, x)).join(" | ")}${pct} |`);
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(summarize(process.argv[2]).scorecard);
}
