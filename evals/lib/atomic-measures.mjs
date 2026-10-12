// The atomic tier's mechanical measures (spec 006 D10, 006-35): each scenario scores the ones it
// declares in evals/atomic/atomic.json, over its cell's pilot record and retained timeline; the
// rest of the record is context. The same rules grade a new cell (pilotRecord) and regrade a
// committed `.atomic.json` from what it kept (regradeAtomic).
import { answeredRuns, coveredRun, currentBeforeClaim } from "./evidence.mjs";
import { covers } from "./selection.mjs";

/** The slow tier's test file in the fixture (its `squeal.config.json` `slow` key). */
const SLOW_FILES = ["test/slow/ledger.test.ts"];

const claimed = (p) => p.claim !== null && p.claim !== undefined;
/** Rule `f` over the retained timeline; not computable for a cell that kept none. */
const reads = (f) => (p, ctx) => (Array.isArray(ctx.timeline) ? f(p, ctx) : null);

/**
 * Each measure over a pilot record `p` and `{ timeline, scenario }`, the cell's retained timeline
 * (evidence.mjs) and its scenario's declaration: `true` met, `false` missed, `null` not
 * computable or not applicable.
 */
export const MEASURES = {
  "claim-true": (p) => (!claimed(p) || p.truthPass === null ? null : p.claimTrue === true),
  "no-false-pass": (p) => (!claimed(p) || p.truthPass === null ? null : !p.falsePass),
  // a1-break: no own Vitest run after Squeal answered, in a turn sent once Squeal settled.
  "no-rerun-answered-turn2": (p) =>
    p.turns < 2 || p.settle?.settled !== true ? null : p.ownRunsAfterAnsweredTurn2 === 0,
  // D10 a2-slow: the slow tier run through Squeal (`run --slow` or `run --all`) after the last
  // edit, before the claim. An own run covering the slow test is context (`slowBeforeClaim`).
  "slow-through-squeal": (p) =>
    !claimed(p) ? null : p.slowBeforeClaim.some((s) => s.what.startsWith("squeal run")),
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
};

/**
 * Scenario `scenario`'s declared measures over record `p` and its retained `timeline`. A scenario
 * that sends a later turn without waiting (`waitSettled: false`, a4-pending) scores nothing when
 * no check was pending as that turn was sent: the situation did not arise.
 */
export function measuresOf(p, { timeline, scenario }) {
  const declared = scenario.measures ?? [];
  const arose = scenario.waitSettled !== false || p.settle?.pending === true;
  return Object.fromEntries(
    declared.map((m) => [m, arose ? MEASURES[m](p, { timeline, scenario }) : null]),
  );
}

/**
 * One cell's pilot record from its mechanical grade (evals/bin/grade.mjs's grade.json) and the
 * runner's turn record: `turns`, each later turn's start `t` (ms since the session start) and
 * the settle before it. Ground truth, the claim, own Vitest runs after Squeal answered (all,
 * and in the last turn), and the slow-tier commands between the last edit and the claim:
 * `squeal run --slow` or `--all`, or an own Vitest run covering the slow file. Its measures are
 * `scenario`'s, or the `declared` ids (the pilot's form) over the grade's retained timeline.
 */
export function pilotRecord(
  grade,
  { turns = 1, turnStarts = [], settle = null, scenario = null, declared = [] },
) {
  const tl = grade.timeline ?? { runs: [], pulls: [], edits: [] };
  const lastEdit = tl.edits.at(-1) ?? null;
  const afterEdit = (x) => lastEdit === null || x.n > lastEdit.n;
  const lastTurn = turnStarts.at(-1) ?? null;
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
    ownRunsAfterAnswered: vitest.filter((r) => r.afterSquealAnswered).length,
    ownRunsAfterAnsweredTurn2:
      lastTurn === null
        ? null
        : vitest.filter((r) => r.afterSquealAnswered && r.t >= lastTurn).length,
    slowBeforeClaim,
    squealWaitsAfterLastEdit: grade.waitsAfterLastEdit ?? null,
    sleeps: grade.sleeps ?? null,
  };
  record.measures = measuresOf(record, {
    timeline: grade.retained ?? null,
    scenario: scenario ?? { measures: declared },
  });
  return record;
}

const BY = "006-35";
const NOTE =
  "Measures recomputed (spec 006 D10, 006-35) from each cell's kept pilot record and retained timeline under evals/atomic/atomic.json at this revision. a2-slow scores `slow-through-squeal`, the slow tier run through `squeal run --slow` or `--all` after the last edit, and `no-rerun-answered`; covering the slow test by any run, the old `slow-before-claim`, stays context in `slowBeforeClaim`. `changed` names the cells whose measures changed.";

/**
 * Results file `data` (a `.atomic.json`) with every cell's measures recomputed under `config`'s
 * declarations, its scenarios' declared measures updated, and a `regraded` note naming the cells
 * it changed (a regrade by this row replaces its own earlier note). A cell of a scenario `config`
 * no longer declares, or without a pilot record, is left as it was.
 */
export function regradeAtomic(data, config, date) {
  const changed = [];
  const cells = data.cells.map((cell) => {
    const scenario = config.scenarios[cell.task];
    if (!scenario || !cell.atomic) return cell;
    const measures = measuresOf(cell.atomic, { timeline: cell.timeline, scenario });
    if (JSON.stringify(measures) === JSON.stringify(cell.atomic.measures)) return cell;
    changed.push(cell.id);
    return { ...cell, atomic: { ...cell.atomic, measures } };
  });
  const scenarios = Object.fromEntries(
    Object.entries(data.scenarios ?? {}).map(([t, s]) => [
      t,
      config.scenarios[t] ? { ...s, measures: config.scenarios[t].measures ?? [] } : s,
    ]),
  );
  const others = (data.regraded ?? []).filter((n) => n.by !== BY);
  const earlier = (data.regraded ?? []).find((n) => n.by === BY);
  const all = [...new Set([...(earlier?.changed ?? []), ...changed])];
  return {
    data: {
      ...data,
      cells,
      scenarios,
      regraded: [...others, { by: BY, date: earlier?.date ?? date, changed: all, note: NOTE }],
    },
    changed,
  };
}
