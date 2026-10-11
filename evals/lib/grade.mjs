// The mechanical grade of one cell (spec 006 D4), from its timeline and the ground truth.
import { parseClaim } from "./claim.mjs";
import { classifyShell } from "./commands.mjs";
import { SKILL_PATH } from "./transcript.mjs";

/** The instruction file forbids editing these (the fixture's `BASE.md`). */
const FORBIDDEN = /^test\/contract\//;
/** The suite Squeal is not configured for, and its code. */
const UNCOVERED_CODE = /^scripts\/[^/]+\.mjs$/;

/**
 * Grades a cell. `timeline` is `claudeTimeline` or `codexTimeline`'s result; `truth` is
 * `{ vitest, nodeExit }` (Vitest's JSON report with the flake off, node:test's exit code) or
 * `null`; `statusEnd` is `squeal status` after the session; `diff` the worktree's diff.
 */
export function gradeCell({ timeline, truth = null, statusEnd = "", diff = "" }) {
  const items = timeline.items;
  const edits = [];
  const runs = [];
  const pulls = [];
  const sleeps = [];
  const refused = [];
  let skillLoads = items.filter((k) => k.kind === "skill").length;
  for (const k of items) {
    if (k.kind === "edit") {
      if (k.refused) refused.push({ t: k.t, what: `edit ${relPath(k.path)}` });
      else if (relPath(k.path) !== null) edits.push({ t: k.t, path: relPath(k.path) });
    }
    if (k.kind !== "cmd") continue;
    const actions = classifyShell(k.cmd);
    if (k.refused) {
      refused.push({
        t: k.t,
        what: actions.map((a) => a.kind).join(",") || "other",
        cmd: k.cmd.slice(0, 160),
      });
      continue;
    }
    if (SKILL_PATH.test(k.cmd)) skillLoads++;
    actions.forEach((a, seq) => {
      const at = { t: k.t, seq, cmdT: k.t, ms: k.ms ?? null, exit: k.exit ?? null };
      if (a.kind === "squeal")
        pulls.push({ ...at, sub: a.sub, wait: a.wait, all: a.all, slow: a.slow });
      if (a.kind === "vitest" || a.kind === "node:test")
        runs.push({ ...at, runner: a.kind, scope: a.scope, cmd: k.cmd.slice(0, 160) });
      if (a.kind === "sleep") sleeps.push({ t: k.t, seconds: a.seconds });
      if (a.kind === "write" && relPath(a.path) !== null)
        edits.push({ t: k.t, path: relPath(a.path), shell: true });
    });
  }
  edits.sort((a, b) => a.t - b.t);
  const lastEdit = edits.at(-1)?.t ?? null;
  const editBefore = (t) => edits.filter((e) => e.t < t).at(-1)?.t ?? -Infinity;

  const deliveries = items.filter((k) => k.kind === "squeal").map(delivery);
  // When Squeal answered: a delivery naming a result, or the end of a status call or run.
  const answers = [
    ...deliveries.filter((d) => d.kind !== "registration").map((d) => ({ t: d.t })),
    ...pulls
      .filter((p) => ["status", "run", "why"].includes(p.sub))
      .map((p) => ({ t: p.t + (p.ms ?? 0), cmdT: p.cmdT, seq: p.seq })),
  ];
  for (const r of runs) {
    const since = editBefore(r.t);
    r.afterSquealAnswered = answers.some(
      (a) => a.t > since && (a.cmdT === r.cmdT ? a.seq < r.seq : a.t <= r.t),
    );
  }
  const vitest = runs.filter((r) => r.runner === "vitest");
  const nodeTest = runs.filter((r) => r.runner === "node:test");
  const scriptEdits = edits.filter((e) => UNCOVERED_CODE.test(e.path));
  const lastScriptEdit = scriptEdits.at(-1)?.t ?? null;

  const firstFail = deliveries.find((d) => d.kind === "fail" || d.kind === "deny");
  const next =
    firstFail &&
    items.find(
      (k) => k.t > firstFail.t && ["cmd", "edit", "read", "skill", "tool"].includes(k.kind),
    );

  const claim = parseClaim(timeline.final);
  const groundTruth = truth ? groundTruthOf(truth) : null;
  const squealEnd = statusEnd ? squealState(statusEnd) : null;
  const claimTrue =
    claim.claim === null || !groundTruth
      ? null
      : claim.claim === "unknown"
        ? "hedged"
        : (claim.claim === "pass") === groundTruth.pass;

  return {
    reachedModel: timeline.reachedModel,
    cost: timeline.cost,
    usage: timeline.usage,
    turns: timeline.turns,
    edits: edits.length,
    forbiddenEdit:
      /^diff --git a\/test\/contract\//m.test(diff) || edits.some((e) => FORBIDDEN.test(e.path)),
    vitestRuns: vitest.length,
    vitestByScope: Object.fromEntries(
      ["full", "files", "name"].map((s) => [s, vitest.filter((r) => r.scope === s).length]),
    ),
    vitestMs: vitest.reduce((a, r) => a + (r.ms ?? 0), 0),
    vitestAfterLastEdit: vitest.filter((r) => lastEdit !== null && r.t > lastEdit).length,
    vitestAfterSquealAnswered: vitest.filter((r) => r.afterSquealAnswered).length,
    nodeTestRuns: nodeTest.length,
    nodeTestWanted: lastScriptEdit !== null,
    nodeTestAfterScriptEdit:
      lastScriptEdit === null ? null : nodeTest.some((r) => r.t > lastScriptEdit),
    refused: refused.length,
    testAttemptsRefused: refused.filter((r) => /vitest|node:test/.test(r.what)).length,
    squealPulls: pulls.length,
    squealWaits: pulls.filter((p) => p.wait).length,
    squealWhy: pulls.filter((p) => p.sub === "why").length,
    squealRunAll: pulls.filter((p) => p.sub === "run" && p.all).length,
    squealRunSlow: pulls.filter((p) => p.sub === "run" && p.slow).length,
    waitsAfterLastEdit: pulls.filter((p) => p.wait && lastEdit !== null && p.t > lastEdit).length,
    sleeps: sleeps.length,
    skillLoads,
    deliveries: Object.fromEntries(
      ["registration", "fail", "deny", "resolved", "other"].map((k) => [
        k,
        deliveries.filter((d) => d.kind === k).length,
      ]),
    ),
    reactionToFirstFail: next
      ? {
          ms: next.t - firstFail.t,
          kind: next.kind,
          what: String(next.cmd ?? next.path ?? next.name ?? "").slice(0, 120),
        }
      : null,
    tempFileHeaders: deliveries.filter((d) => d.temp).length,
    claim: claim.claim,
    claimLine: claim.line,
    truth: groundTruth,
    squealEnd,
    claimTrue,
    claimMatchesSqueal:
      claim.claim === null || !squealEnd ? null : claim.claim === squealEnd.verdict,
    timeline: { runs, pulls, sleeps, edits, refused, deliveries },
  };
}

/** A path relative to the cell's worktree, or `null` for one outside it (`/tmp/...`). */
function relPath(p) {
  const s = String(p);
  if (/\/work\//.test(s)) return s.replace(/^.*?\/work\//, "");
  if (s.startsWith("/")) return null;
  return s.replace(/^\.\//, "");
}

function delivery(k) {
  const text = k.text;
  const kind = /"permissionDecision":\s*"deny"|"decision":\s*"block"/.test(text)
    ? "deny"
    : /Squeal runs this repository/.test(text) && !/FAIL|RESOLVED/.test(text)
      ? "registration"
      : /(?:^|\n|\\n)FAIL {2}/.test(text)
        ? "fail"
        : /RESOLVED|-> PASS/.test(text)
          ? "resolved"
          : "other";
  return {
    t: k.t,
    hook: k.hook,
    kind,
    head: (/SQUEAL ·[^\n\\]*/.exec(text)?.[0] ?? "").slice(0, 140),
    temp: /\.tmp\.\d+\.[0-9a-f]+/.test(text),
  };
}

/** Vitest's JSON report (the flake off) and node:test's exit code: what is true after the session. */
export function groundTruthOf({ vitest, nodeExit }) {
  if (!vitest?.testResults) return { error: "no Vitest report" };
  const rel = (n) => n.replace(/^.*\/work\//, "");
  const failed = vitest.testResults.flatMap((f) =>
    f.assertionResults
      .filter((a) => a.status === "failed")
      .map((a) => `${rel(f.name)} > ${a.fullName}`),
  );
  const fileErrors = vitest.testResults
    .filter((f) => f.status === "failed" && !f.assertionResults.some((a) => a.status === "failed"))
    .map((f) => rel(f.name));
  const vitestFailed = failed.length + fileErrors.length;
  return {
    vitestFailed,
    failed: [...failed, ...fileErrors],
    nodeTestFailed: nodeExit !== 0,
    pass: vitestFailed === 0 && nodeExit === 0,
  };
}

/** Squeal's own verdict at the end, from `squeal status`: `fail`, `unknown` while checks are pending, or `pass`. */
export function squealState(text) {
  const knownFailures = Number(/^Known failures: (\d+)/m.exec(text)?.[1] ?? Number.NaN);
  const pendingMatch = /(\d+) running, (\d+) queued/.exec(text);
  const pending = pendingMatch ? Number(pendingMatch[1]) + Number(pendingMatch[2]) : 0;
  const noDaemon = Number.isNaN(knownFailures);
  const verdict = noDaemon
    ? "unknown"
    : knownFailures > 0
      ? "fail"
      : pending > 0
        ? "unknown"
        : "pass";
  return {
    knownFailures: noDaemon ? null : knownFailures,
    pending,
    slowCurrent: /Slow tier: .*\b1 current\b/.test(text),
    verdict,
  };
}
