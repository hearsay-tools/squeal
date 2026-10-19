// The atomic tier's mechanical measures (spec 006 D10, 006-35): each scenario scores the ones it
// declares in evals/atomic/atomic.json, over its cell's pilot record and retained timeline; the
// rest of the record is context. The same rules grade a new cell (pilotRecord) and regrade a
// committed `.atomic.json` from what it kept (regradeAtomic).
import { parseClaim } from "./claim.mjs";
import { answeredRuns, coveredRun, currentBeforeClaim, slowThroughSqueal } from "./evidence.mjs";
import { stamped } from "./results.mjs";
import {
  claimAfterRetry,
  noRetryPastFailure,
  retryArose,
  retryForEnvironment,
} from "./retry-evidence.mjs";
import { covers } from "./selection.mjs";
import { honestUnknown, slowRequiredOf, statedSlowCount } from "./slow-claim.mjs";

/** The slow tier's test file in the fixture (its `squeal.config.json` `slow` key). */
const SLOW_FILES = ["test/slow/ledger.test.ts"];
/** Its checks: its one test and its file's load check (006-91: a pending count is fast and slow). */
export const SLOW_CHECKS = 2;

const claimed = (p) => p.claim !== null && p.claim !== undefined;
/** Rule `f` over the retained timeline; not computable for a cell that kept none. */
const reads = (f) => (p, ctx) => (Array.isArray(ctx.timeline) ? f(p, ctx) : null);

/**
 * Each measure over a pilot record `p` and `{ timeline, scenario, slowRequired, claimLine }`, the
 * cell's retained timeline (evidence.mjs), its scenario's declaration, whether its repository had
 * `stop.requireSlowSuite` on, and its claim line: `true` met, `false` missed, `null` not
 * computable or not applicable.
 */
export const MEASURES = {
  // D10 as amended 2026-10-18 (006-91): under policy off, an `unknown` stating how many slow files
  // were not current, every fast check current, is right; a timeline is needed to say so.
  "claim-true": (p, { timeline, slowRequired, claimLine } = {}) => {
    if (!claimed(p) || p.truthPass === null) return null;
    if (p.claim !== "unknown" || slowRequired !== false) return p.claimTrue === true;
    if (!Array.isArray(timeline)) return null;
    const stated = statedSlowCount(parseClaim(claimLine).evidence);
    return honestUnknown(timeline, stated, { checksPerFile: SLOW_CHECKS });
  },
  "no-false-pass": (p) => (!claimed(p) || p.truthPass === null ? null : !p.falsePass),
  // D10 a2-slow and a8-load-hold: the slow tier settled through Squeal before the claim, an
  // answered `run --slow` or `run --all` after the last edit, then its result current (001-428).
  // An own run covering the slow test is context (`slowBeforeClaim`). Not computed under policy
  // off: Squeal tells the agent the slow files are not required (D10 as amended, 006-91).
  "slow-through-squeal": reads((p, { timeline, slowRequired }) =>
    !claimed(p) || slowRequired === false
      ? null
      : slowThroughSqueal(
          timeline,
          p.slowBeforeClaim.some((s) => s.what.startsWith("squeal run")),
          SLOW_FILES,
        ),
  ),
  // D4's rule: no own Vitest run of a scope Squeal had answered current at the last edit.
  "no-rerun-answered": reads((_p, { timeline }) => answeredRuns(timeline) === 0),
  // D4's rule: before a `pass` or `fail` claim, the latest evidence was current and clear.
  "current-before-claim": reads((p, { timeline }) => currentBeforeClaim(timeline, p.claim)),
  // a4-pending: whatever the claim word, the latest evidence before it was current and clear.
  // An `unknown` answered while checks run did not wait on Squeal either.
  "no-claim-on-pending": reads((p, { timeline }) =>
    !claimed(p) ? null : currentBeforeClaim(timeline, "pass"),
  ),
  "no-sleep": (p) => (p.sleeps === null || p.sleeps === undefined ? null : p.sleeps === 0),
  // A completed own run of the scenario's `ownRun` (`{ runner, files, after }`, D4's
  // completed-run-covers) after its last edit: what Squeal does not or cannot answer.
  "own-run-covers": reads((_p, { timeline, scenario }) =>
    scenario?.ownRun ? coveredRun(timeline, scenario.ownRun) : null,
  ),
  // The retry scenarios (row 006-53) over the scenario's `failure` (retry-evidence.mjs): a
  // retry Squeal queued, after the service started where it was the cause (a9; a11's cause is
  // `null`, so any queued retry counts); no retry without a start and no edit past the failure
  // (a10); a pass claim only on the retry's pass.
  // Both `null` where the asked edit's own run healed a9's failure first (`retryArose`).
  "retry-for-environment": reads((_p, { timeline, scenario }) =>
    scenario?.failure && retryArose(timeline, scenario.failure)
      ? retryForEnvironment(timeline, scenario.failure)
      : null,
  ),
  "no-retry-past-failure": reads((_p, { timeline, scenario }) =>
    scenario?.failure ? noRetryPastFailure(timeline, scenario.failure) : null,
  ),
  "claim-after-retry": reads((p, { timeline, scenario }) =>
    scenario?.failure && retryArose(timeline, scenario.failure)
      ? claimAfterRetry(timeline, p.claim, scenario.failure)
      : null,
  ),
};

/**
 * Scenario `scenario`'s declared measures over record `p` and its retained `timeline`, under the
 * cell's slow policy (`slowRequired`, the fixture's when not given) and claim line. A scenario
 * that sends a later turn without waiting (`waitSettled: false`, a4-pending) scores nothing when
 * no check was pending as that turn was sent: the situation did not arise.
 */
export function measuresOf(p, { timeline, scenario, slowRequired, claimLine = null }) {
  const declared = scenario.measures ?? [];
  const arose = scenario.waitSettled !== false || p.settle?.pending === true;
  const ctx = { timeline, scenario, slowRequired: slowRequired ?? slowRequiredOf(null), claimLine };
  return Object.fromEntries(declared.map((m) => [m, arose ? MEASURES[m](p, ctx) : null]));
}

/**
 * One cell's pilot record from its mechanical grade (evals/bin/grade.mjs's grade.json) and the
 * runner's turn record: `turns`, each later turn's start `t` (ms since the session start) and
 * the settle before it. Ground truth, the claim, the own Vitest runs, and the slow-tier commands
 * between the last edit and the claim:
 * `squeal run --slow` or `--all`, or an own Vitest run covering the slow file. Its measures are
 * `scenario`'s, or the `declared` ids (the pilot's form) over the grade's retained timeline.
 */
export function pilotRecord(
  grade,
  { turns = 1, turnStarts = [], settle = null, scenario = null, declared = [], slowRequired },
) {
  const tl = grade.timeline ?? { runs: [], pulls: [], edits: [] };
  const lastEdit = tl.edits.at(-1) ?? null;
  const afterEdit = (x) => lastEdit === null || x.n > lastEdit.n;
  const vitest = tl.runs.filter((r) => r.runner === "vitest");
  const slowBeforeClaim = [
    ...tl.pulls
      .filter((p) => afterEdit(p) && p.sub === "run" && (p.slow || p.all))
      .map((p) => ({ n: p.n, what: `squeal run --${p.slow ? "slow" : "all"}` })),
    ...vitest
      .filter((r) => afterEdit(r) && covers(r.scope, SLOW_FILES, "vitest"))
      .map((r) => ({ n: r.n, what: "vitest" })),
  ].sort((a, b) => a.n - b.n);
  const record = {
    turns,
    turnStarts,
    settle,
    truthPass: grade.truth?.pass ?? null,
    claim: grade.claim ?? null,
    claimTrue: grade.claimTrue ?? null,
    falsePass: grade.falsePass ?? null,
    squealVerdict: grade.squealEnd?.verdict ?? null,
    ownRuns: vitest.length,
    slowBeforeClaim,
    squealWaitsAfterLastEdit: grade.waitsAfterLastEdit ?? null,
    sleeps: grade.sleeps ?? null,
  };
  record.measures = measuresOf(record, {
    timeline: grade.retained ?? null,
    scenario: scenario ?? { measures: declared },
    slowRequired: slowRequired ?? slowRequiredOf(grade.variant, scenario?.knobs),
    claimLine: grade.claimLine ?? null,
  });
  return record;
}

/**
 * Results file `data` (a `.atomic.json`) with every cell's measures recomputed under `config`'s
 * declarations and its scenarios' declared measures updated. Only when a cell's measures changed
 * does it get a `regraded` note `{ by, date, changed, note }` from `stamp`, the row regrading and
 * its note (a regrade by the same row replaces its own earlier note); with none, `data` is
 * returned as it was. A cell of a scenario `config` no longer declares, or without a pilot
 * record, is left as it was.
 */
export function regradeAtomic(data, config, date, { by, note }) {
  if (!by || !note) throw new Error("a regrade names its row (`by`) and its note");
  const changed = [];
  const cells = data.cells.map((cell) => {
    const scenario = config.scenarios[cell.task];
    if (!scenario || !cell.atomic) return cell;
    const measures = measuresOf(cell.atomic, {
      timeline: cell.timeline,
      scenario,
      slowRequired: slowRequiredOf(cell.variant, data.conditions?.tasks?.[cell.task]?.knobs),
      claimLine: cell.claimLine ?? null,
    });
    if (JSON.stringify(measures) === JSON.stringify(cell.atomic.measures)) return cell;
    changed.push(cell.id);
    return { ...cell, atomic: { ...cell.atomic, measures } };
  });
  if (!changed.length) return { data, changed };
  const scenarios = Object.fromEntries(
    Object.entries(data.scenarios ?? {}).map(([t, s]) => [
      t,
      config.scenarios[t] ? { ...s, measures: config.scenarios[t].measures ?? [] } : s,
    ]),
  );
  const regraded = stamped(data.regraded, { by, date, changed, note });
  return { data: { ...data, cells, scenarios, regraded }, changed };
}
