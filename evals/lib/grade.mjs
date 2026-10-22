// The mechanical grade of one cell (spec 006 D4), from its timeline and the ground truth.
import { gradeClaim, parseClaim } from "./claim.mjs";
import { classifyShell, scopeLabel } from "./commands.mjs";
import { completedRuns, failedChecks, NO_DAEMON, retainedOf } from "./evidence.mjs";
import { answered } from "./squeal-text.mjs";
import { SKILL_PATH, transcriptOf } from "./transcript.mjs";

/** The instruction file forbids editing these (the fixture's `BASE.md`). */
const FORBIDDEN = /^test\/contract\//;

/**
 * Grades a cell. `timeline` is `claudeTimeline` or `codexTimeline`'s result; `truth` is
 * `{ vitest, completion }` (Vitest's JSON report with the flake off, `out/truth.json`) or `null`
 * when the cell has none; `statusEnd` is `squeal status --json` after the session, as text or
 * parsed, and `plugin` whether the cell had Squeal at all; `diff` the worktree's diff.
 *
 * Only executed actions count (review wave 1, B2): a refused one is an attempt, an indeterminate
 * one is listed and never counted. Every action has a place `n` in the session's order, so an
 * edit and a run in one call keep theirs.
 *
 * `serviceStarts` is the rates service's own record of the session's starts, `{ t, reply }` in
 * ms since the session's start (`serviceStartsOf`, rows 006-67 and 006-72), or `null` when the
 * cell kept none. With a record, the record alone says when the service came up: each `listening`
 * line is a service step at its own time, after every action of a call issued at or before it,
 * and no command's (a start in the background or redirected has no reply of its own; review
 * 006-70 B1). Start commands add no step, and `already running` and failed lines none. Without
 * one, a start is a step at its call, started when its output's reply in turn says `listening`.
 */
export function gradeCell({
  timeline,
  truth = null,
  statusEnd = null,
  plugin = true,
  diff = "",
  serviceStarts = null,
}) {
  const items = timeline.items;
  const edits = [];
  const failedEdits = [];
  const runs = [];
  const pulls = [];
  const sleeps = [];
  const refused = [];
  const indeterminate = [];
  let skillLoads = items.filter((k) => k.kind === "skill").length;
  let n = 0;
  // The retained timeline (D4 "Retained evidence"), each step at the time the agent saw it: a
  // pull's evidence when its call returned, after every action of that call.
  const seen = [];
  const at = (t, step, phase = 0) => seen.push({ t, phase, i: seen.length, step });
  for (const [call, k] of items.entries()) {
    if (k.kind === "squeal") {
      at(k.t, { from: "push", text: k.text });
    }
    if (k.kind === "edit") {
      const path = relPath(k.path);
      if (k.refused) refused.push({ t: k.t, what: `edit ${path ?? k.path}` });
      else if (k.failed) failedEdits.push({ t: k.t, path: path ?? k.path });
      else if (path !== null) {
        edits.push({ t: k.t, n: n++, call, path });
        at(k.t, { k: "edit", path });
      }
    }
    if (k.kind !== "cmd") continue;
    const actions = classifyShell(k.cmd, {
      exit: k.exit ?? null,
      output: k.out ?? "",
      refused: !!k.refused,
    });
    if (k.refused) {
      refused.push({
        t: k.t,
        what: actions.map((a) => a.kind).join(",") || "other",
        cmd: k.cmd.slice(0, 160),
      });
      continue;
    }
    if (SKILL_PATH.test(k.cmd)) skillLoads++;
    const summaries = completedRuns(k.out);
    // Each retry and service start takes its own reply from the call's output, in order (006-57 B2).
    const replies = { retry: retryReplies(k.out), service: serviceReplies(k.out) };
    // Which of the call's Squeal commands Squeal answered, each by its own CLI (review 006-63 B2).
    const executed = actions.filter((a) => a.kind === "squeal" && a.execution === "executed");
    const replied = answered(
      k.out,
      k.exit ?? null,
      executed.map((a) => a.bin),
    );
    let unsure = null;
    for (const a of actions) {
      const here = { t: k.t, n: n++, call, ms: k.ms ?? null, exit: k.exit ?? null };
      if (a.execution !== "executed") {
        const what = a.kind === "write" ? `write ${relPath(a.path) ?? a.path}` : a.kind;
        indeterminate.push({ t: k.t, what, cmd: k.cmd.slice(0, 160) });
        continue;
      }
      if (a.kind === "squeal") {
        const reply = replied[executed.indexOf(a)];
        const noDaemon = NO_DAEMON.test(k.out ?? "");
        // A command the output cannot say Squeal answered is no pull, wait or slow run.
        if (reply === true)
          pulls.push({ ...here, sub: a.sub, wait: a.wait, all: a.all, slow: a.slow, noDaemon });
        // `squeal why` explains a result; it is not evidence of the current one (B2).
        if (reply === true && (a.sub === "status" || a.sub === "run"))
          at(k.t + (k.ms ?? 0), { from: "pull", sub: a.sub, text: k.out ?? "" }, 1);
        if (reply === null && (a.sub === "status" || a.sub === "run"))
          unsure = unsure === "run" ? "run" : a.sub;
        // In the call's order with its other actions, as a run or an edit (review 006-57 B2).
        if (a.sub === "retry") at(k.t, retryStep(a, replies.retry));
        // An executed run is an action whatever it printed: redirected, empty, or a request not
        // yet recorded leaves no evidence, yet a run was asked for (re-review 006-59 R1). It keeps
        // whether Squeal answered it, which the slow tier's measure needs (001-428).
        if (a.sub === "run")
          at(k.t, { k: "squeal-run", all: a.all, slow: a.slow, answered: reply === true });
      }
      // A start that found the service running changes nothing (row 006-53).
      if (a.kind === "service" && serviceStarts === null)
        at(k.t, { k: "service", started: replies.service.shift() === "listening" });
      if (a.kind === "vitest" || a.kind === "node:test") {
        const runner = a.runner ?? a.kind;
        runs.push({ ...here, runner, scope: a.scope, cmd: k.cmd.slice(0, 160) });
        at(k.t, {
          k: "run",
          runner,
          informational: a.informational === true,
          scope: a.scope,
          completed: !a.informational && summaries[runner]-- > 0,
          exit: k.exit ?? null,
          failed: runner === "vitest" ? failedChecks(k.out) : [],
        });
      }
      if (a.kind === "sleep") {
        sleeps.push({ t: k.t, seconds: a.seconds });
        at(k.t, { k: "sleep", s: a.seconds });
      }
      if (a.kind === "write" && relPath(a.path) !== null) {
        edits.push({ t: k.t, n: here.n, call, path: relPath(a.path), shell: true });
        at(k.t, { k: "edit", path: relPath(a.path) });
      }
    }
    // Squeal's text the agent read, when no command it surely answered carries it: once, as a
    // run's when one may have printed it, so it closes a retry's window and credits no pass.
    if (unsure !== null && !replied.includes(true))
      at(k.t + (k.ms ?? 0), { from: "pull", sub: unsure, text: k.out ?? "" }, 1);
  }
  for (const { t, reply } of serviceStarts ?? [])
    if (reply === "listening") at(t, { k: "service", started: true });
  const lastEdit = edits.at(-1) ?? null;
  const deliveries = items.filter((k) => k.kind === "squeal").map(delivery);
  const vitest = runs.filter((r) => r.runner === "vitest");
  const nodeTest = runs.filter((r) => r.runner === "node:test");

  const claim = parseClaim(timeline.final);
  const said = items.filter((k) => k.kind === "say").at(-1);
  at(said?.t ?? Number.POSITIVE_INFINITY, { k: "claim" });
  const groundTruth = truth ? groundTruthOf(truth) : null;
  const squealEnd = plugin ? squealState(statusEnd) : null;
  const claimGrades = gradeClaim({
    claim: claim.claim,
    truthPass: groundTruth && !groundTruth.error ? groundTruth.pass : null,
    squeal: squealEnd,
  });

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
      ["full", "files", "name"].map((s) => [
        s,
        vitest.filter((r) => scopeLabel(r.scope) === s).length,
      ]),
    ),
    nodeTestRuns: nodeTest.length,
    refused: refused.length,
    failedEdits: failedEdits.length,
    indeterminate: indeterminate.length,
    testAttemptsRefused: refused.filter((r) => /vitest|node:test/.test(r.what)).length,
    squealPulls: pulls.length,
    squealWaits: pulls.filter((p) => p.wait).length,
    squealWhy: pulls.filter((p) => p.sub === "why").length,
    squealRunSlow: pulls.filter((p) => p.sub === "run" && p.slow).length,
    waitsAfterLastEdit: pulls.filter((p) => p.wait && lastEdit !== null && p.n > lastEdit.n).length,
    sleeps: sleeps.length,
    skillLoads,
    deliveries: Object.fromEntries(
      ["registration", "fail", "deny", "resolved", "noDaemon", "other"].map((k) => [
        k,
        deliveries.filter((d) => d.kind === k).length,
      ]),
    ),
    claim: claim.claim,
    claimLine: claim.line,
    truth: groundTruth,
    squealEnd,
    ...claimGrades,
    timeline: { runs, pulls, sleeps, edits, failedEdits, refused, indeterminate, deliveries },
    retained: retainedOf(seen),
    // D9: the numbered, trimmed transcript the judge reads; the run redacts it before keeping it.
    transcript: transcriptOf(timeline),
  };
}

/**
 * A `squeal retry` call as a retained step (row 006-53): the paths it named relative to the
 * worktree, its reason, whether it withdrew, and the test files Squeal's reply says it queued.
 * It takes one reply line per path from `replies`, the call's in order (review 006-57 B2).
 */
function retryStep(a, replies) {
  const mine = replies.splice(0, Math.max(a.paths.length, 1));
  return {
    k: "retry",
    paths: a.paths.map((p) => relPath(p) ?? p),
    reason: a.reason,
    cancel: a.cancel,
    queued: mine.filter((r) => r.queued).map((r) => r.file),
  };
}

/**
 * Squeal's per-file retry replies in `out`, in order (spec 001 D6, 001-368's texts): `{ file,
 * queued }`, `queued` for `Retry queued`, not for a refusal or a withdrawal.
 */
function retryReplies(out) {
  const re =
    /^(?:Retry queued \(reason: \w+\): (\S+)|Not retried: (\S+)|Retry withdrawn: (\S+)|No pending retry of (\S+))/gm;
  return [...String(out ?? "").matchAll(re)].map((m) => ({
    file: m[1] ?? m[2] ?? m[3] ?? m[4],
    queued: m[1] !== undefined,
  }));
}

/** The rates service's start replies in `out`, in order: `listening` or `running`. */
const serviceReplies = (out) =>
  [...String(out ?? "").matchAll(/^rates service (listening|already running)/gm)].map((m) =>
    m[1] === "listening" ? "listening" : "running",
  );

/**
 * The rates service's record of starts (`out/service-starts.txt`: a line per start, `<ms since the
 * epoch>\t<what it said>`) as `{ t, reply }`, `t` in ms since the session's start `t0`, `reply`
 * `listening`, `running` or `failed`. A line without a time is skipped.
 */
export function serviceStartsOf(text, t0) {
  return String(text)
    .split("\n")
    .map((l) => /^(\d+)\t(.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ t: Number(m[1]) - t0, reply: serviceReplies(m[2])[0] ?? "failed" }));
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
    : /registered at revision|Squeal runs this repository/.test(text) && !/FAIL|RESOLVED/.test(text)
      ? "registration"
      : /(?:^|\n|\\n)FAIL {2}/.test(text)
        ? "fail"
        : /RESOLVED|-> PASS/.test(text)
          ? "resolved"
          : NO_DAEMON.test(text)
            ? "noDaemon"
            : /SQUEAL · (?:revision|\d+ checks? changed)/.test(text)
              ? "result"
              : "other";
  return {
    t: k.t,
    hook: k.hook,
    kind,
    head: (/SQUEAL ·[^\n\\]*/.exec(text)?.[0] ?? "").slice(0, 140),
  };
}

/**
 * What is true after the session, from Vitest's JSON report (the flake off) and `completion`, the
 * runner's `out/truth.json`: `{ vitest, nodeTest }`, each `{ exit, signal, timedOut, spawnError }`,
 * `nodeTest` with its `files`. Review wave 1, B3: pass needs both commands completed (a numeric
 * exit, no signal, no timeout, no spawn error), at least one node:test file and a valid, non-empty
 * report. Anything else is `{ error }`, truth unavailable, never a pass or a fail.
 */
export function groundTruthOf({ vitest, completion }) {
  const unavailable =
    notCompleted(completion?.vitest, "Vitest") ??
    notCompleted(completion?.nodeTest, "node:test") ??
    (Number.isInteger(completion.nodeTest.files) && completion.nodeTest.files > 0
      ? null
      : "no node:test file left to run") ??
    invalidReport(vitest);
  if (unavailable !== null) return { error: `truth unavailable: ${unavailable}` };
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
  const vitestExit = completion.vitest.exit;
  const nodeTestExit = completion.nodeTest.exit;
  // The report's own verdict: an unhandled error fails the run with no failed assertion.
  const reportFailed =
    vitest.success === false || vitest.numFailedTests > 0 || vitest.numFailedTestSuites > 0;
  return {
    vitestFailed,
    failed: [...failed, ...fileErrors],
    nodeTestFailed: nodeTestExit !== 0,
    vitestExit,
    nodeTestExit,
    pass: vitestFailed === 0 && !reportFailed && vitestExit === 0 && nodeTestExit === 0,
  };
}

/** Why `c`, one command's completion record, is not a completed run; `null` when it is. */
function notCompleted(c, name) {
  if (typeof c !== "object" || c === null) return `no completion record for ${name}`;
  if (c.spawnError !== null) return `${name} could not start`;
  if (c.timedOut !== false) return `${name} timed out`;
  if (c.signal !== null) return `${name} ended by a signal`;
  if (!Number.isInteger(c.exit)) return `${name} has no exit code`;
  return null;
}

/** The statuses of a test that ran to its end, or was skipped or left as todo. */
const COMPLETED = new Set(["passed", "failed", "skipped", "todo"]);
const isCount = (n) => Number.isInteger(n) && n >= 0;

/**
 * Why `vitest` is not a report to read; `null` when it is (review wave 1.5, SF1). Every file is
 * named, `passed` or `failed`, and lists its tests, each completed; a passed file has a test and
 * none failed. The test counts are present and match the tests, a suite count is a count, and
 * `success` is a boolean no failure contradicts.
 */
function invalidReport(vitest) {
  const files = vitest?.testResults;
  if (!Array.isArray(files) || files.length === 0) return "no Vitest report with test files";
  const fileValid = (f) =>
    typeof f?.name === "string" &&
    (f.status === "passed" || f.status === "failed") &&
    Array.isArray(f.assertionResults) &&
    f.assertionResults.every((a) => COMPLETED.has(a?.status)) &&
    (f.status === "failed" ||
      (f.assertionResults.length > 0 && f.assertionResults.every((a) => a.status !== "failed")));
  if (!files.every(fileValid)) return "the Vitest report has a malformed or unfinished test file";
  const tests = files.flatMap((f) => f.assertionResults);
  const n = (status) => tests.filter((a) => a.status === status).length;
  const counts = {
    numTotalTests: tests.length,
    numPassedTests: n("passed"),
    numFailedTests: n("failed"),
    numPendingTests: n("skipped"),
    numTodoTests: n("todo"),
  };
  if (Object.entries(counts).some(([k, v]) => !isCount(vitest[k]) || vitest[k] !== v))
    return "the Vitest report's test counts do not match its tests";
  const suites = ["numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites"];
  if ([...suites, "numPendingTestSuites"].some((k) => k in vitest && !isCount(vitest[k])))
    return "the Vitest report's suite counts are not counts";
  const failed = files.some((f) => f.status === "failed") || vitest.numFailedTestSuites > 0;
  if (typeof vitest.success !== "boolean" || (vitest.success && failed))
    return "the Vitest report's success does not match its tests";
  return null;
}

/**
 * Squeal's own verdict at the end, from `squeal status --json` (text or parsed): `fail` on a
 * known failure, `pass` only when every check is current and settled with a daemon validating,
 * else `unknown` with its `reasons` (review wave 1, B4: stale, unknown, pending, unlisted or
 * unrefined state is never a pass). A missing or unsupported status is `supported: false`.
 */
export function squealState(raw) {
  const s = parseStatus(raw);
  const unsupported = (why) => ({
    knownFailures: null,
    pending: 0,
    slowCurrent: false,
    daemon: false,
    verdict: "unknown",
    supported: false,
    reasons: [why],
  });
  if (typeof s === "string") return unsupported(s);
  if (s.schemaVersion !== 1) return unsupported(`status schema ${s.schemaVersion} not supported`);
  if (s.available !== true) return unsupported(`status unavailable: ${s.reason ?? "no reason"}`);
  const fields = [s.counts, s.testFilesWithoutChecks, s.breakdown?.currentByOutcome, s.daemon];
  if (!Array.isArray(s.knownFailures) || fields.some((f) => typeof f !== "object" || f === null))
    return unsupported("status lacks the fields of the current-state contract");
  // Review wave 1.5, SF2: every count the verdict reads is one, or the status is unsupported.
  const read = [
    s.counts.pending,
    s.counts.stale,
    s.counts.unknown,
    s.testFilesWithoutChecks.pending,
    s.testFilesWithoutChecks.unknown,
    s.breakdown.currentByOutcome.unknown,
  ];
  if (s.slowTier !== undefined && s.slowTier !== null)
    read.push(s.slowTier.testFiles, s.slowTier.current);
  if (!read.every(isCount)) return unsupported("status counts are missing or not counts");

  // Row 011-34: a stopping daemon's heartbeat can still be fresh; it validates nothing.
  const daemon = s.daemon.state === "alive" && s.daemon.stopping === undefined;
  const pending = s.counts.pending + s.testFilesWithoutChecks.pending;
  const tier = s.slowTier;
  const reasons = [
    [!daemon, "no daemon validating"],
    [s.testFilesListed === false, "test files not listed yet"],
    [s.awaitingInstall === true, "waiting for an install"],
    [s.runnerPartPending === true || s.refinedRevision === null, "the runner part is pending"],
    [s.counts.pending > 0, `${s.counts.pending} checks pending`],
    [s.counts.stale > 0, `${s.counts.stale} checks stale`],
    [s.counts.unknown > 0, `${s.counts.unknown} checks unknown`],
    [s.breakdown.currentByOutcome.unknown > 0, "current checks of unknown outcome"],
    [s.testFilesWithoutChecks.pending > 0, "test files without checks pending"],
    [s.testFilesWithoutChecks.unknown > 0, "test files without checks unknown"],
    [tier?.sourcesChangedSince === true, "slow results older than their sources"],
  ]
    .filter(([applies]) => applies)
    .map(([, why]) => why);
  const knownFailures = s.knownFailures.length;
  return {
    knownFailures,
    pending,
    slowCurrent: !!tier && tier.testFiles > 0 && tier.current === tier.testFiles,
    daemon,
    // Without a daemon, status reports the store's last results: not Squeal's verdict on the work.
    verdict: daemon && knownFailures > 0 ? "fail" : reasons.length ? "unknown" : "pass",
    supported: true,
    reasons,
  };
}

/** The status object, or why there is none. */
function parseStatus(raw) {
  if (raw === null || raw === undefined || raw === "") return "no status";
  if (typeof raw === "object") return raw;
  try {
    const s = JSON.parse(String(raw));
    return typeof s === "object" && s !== null ? s : "status is not a JSON object";
  } catch {
    return "status is not JSON";
  }
}
