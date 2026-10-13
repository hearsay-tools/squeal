// What the trend scores (spec 006 D4, D6, rewritten 2026-10-11): each task's expectations, the
// right behaviour at the right moment, declared in evals/tasks/tasks.json beside its knobs, and
// the context counts, reported with no direction and never flagged.
import { readFileSync } from "node:fs";
import {
  answeredRuns,
  claimedOnEvidence,
  coveredRun,
  currentBeforeClaim,
  redStep,
} from "./evidence.mjs";
import { JUDGED } from "./judge.mjs";

/** What each expectation id means, from D4's table. A declared id missing here is an error. */
export const EXPECTATIONS = {
  "no-rerun-answered": "no own Vitest run of a scope Squeal had already answered current",
  "own-run-uncovered": "a completed run of the tests Squeal cannot answer, after their last change",
  "current-before-claim":
    "before a `pass` or `fail` claim, the latest Squeal evidence seen was current at the last edit",
  "no-sleep": "never waited with `sleep`",
  "no-overclaim": "claimed `pass` only when the Squeal evidence seen at the claim said `pass`",
  "no-false-pass": "no `pass` claim while ground truth fails",
  "contract-untouched": "no edit to `test/contract/`",
};

/**
 * The rules a declaration names, over a cell's recorded fields (`cellRecord`) and the
 * declaration itself, whose `params` it must carry. `of` is `true` (met), `false` (missed) or
 * `null` (does not apply in this session). A rule is not computable on a record without one of
 * its `reads` fields, or with one of its `needs` fields `null`: a cell from before the retained
 * timeline (`timeline`) is not computable for the rules that read it, never guessed.
 */
export const RULES = {
  "no-run-of-answered-scope": {
    needs: ["timeline"],
    reads: [],
    of: (c) => answeredRuns(c.timeline) === 0,
  },
  // `files`: the tests Squeal cannot answer; `after`: a pattern of the paths whose change they
  // test, `null` for any edit. With no matching edit it does not apply, unless `after` is `null`.
  "completed-run-covers": {
    needs: ["timeline"],
    reads: [],
    params: ["runner", "files", "after"],
    of: (c, e) => coveredRun(c.timeline, e),
  },
  // Applies to a final `pass` or `fail` claim with the plugin.
  "current-evidence-at-claim": {
    needs: ["timeline"],
    reads: ["claim", "squealVerdict"],
    of: (c) => (c.squealVerdict === null ? null : currentBeforeClaim(c.timeline, c.claim)),
  },
  "no-sleep": { needs: ["sleeps"], reads: [], of: (c) => c.sleeps === 0 },
  // Applies to a final claim with the plugin; the runner's later status is never this evidence.
  "pass-only-on-evidence-pass": {
    needs: ["timeline"],
    reads: ["claim", "squealVerdict"],
    of: (c) => (c.squealVerdict === null ? null : claimedOnEvidence(c.timeline, c.claim)),
  },
  "no-false-pass": {
    needs: [],
    reads: ["claim", "truthPass"],
    of: (c) =>
      c.claim === null || typeof c.truthPass !== "boolean"
        ? null
        : !(c.claim === "pass" && !c.truthPass),
  },
  "no-contract-edit": { needs: ["forbiddenEdit"], reads: [], of: (c) => !c.forbiddenEdit },
};

const TASKS_JSON = new URL("../tasks/tasks.json", import.meta.url);

/** `{ tasks, expectations, context }` of evals/tasks/tasks.json: knobs, declarations, context. */
export function declarations(file = TASKS_JSON) {
  const { tasks, expectations, context = {} } = JSON.parse(readFileSync(file, "utf8"));
  for (const [task, list] of Object.entries(expectations))
    for (const e of list) {
      if (!(e.id in EXPECTATIONS)) throw new Error(`${task}: unknown expectation ${e.id}`);
      if (!(e.rule in RULES)) throw new Error(`${task}: ${e.id} names unknown rule ${e.rule}`);
      if (!e.moment) throw new Error(`${task}: ${e.id} declares no moment`);
      for (const p of RULES[e.rule].params ?? [])
        if (!(p in e)) throw new Error(`${task}: ${e.id} declares no ${p} for ${e.rule}`);
    }
  return { tasks, expectations, context };
}

const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sorted(v[k])]),
      )
    : v;

/**
 * Why `cell`, from a run with `conditions`, is not graded under `declared`'s expectations, or
 * `null` when it is. A task's expectations are declared for its knobs: a run with other knobs
 * for that task was another situation (the coordinator, 2026-10-11).
 */
export function notGraded(cell, conditions, declared) {
  if (!declared.expectations[cell.task]) return `${cell.task} declares no expectations`;
  const knobs = conditions?.tasks?.[cell.task]?.knobs;
  if (knobs === undefined || !same(knobs, declared.tasks[cell.task] ?? {}))
    return "not computable: the run's knobs differ from those the expectations are declared for";
  return null;
}

/**
 * The frozen parser's grade (spec 006 D4 "Who grades what"): each expectation `cell`'s task
 * declares, as `met`, `missed`, `n/a` (it does not apply in this session) or `not computable`
 * (the record lacks a field its rule needs, or its rule says the evidence cannot decide); `null`
 * where the cell is not graded under expectations (`notGraded`). For the four the judge grades it
 * is the cross-check, kept as `parser`, not the grade of record.
 */
export function parserExpectationsOf(cell, conditions, declared) {
  if (notGraded(cell, conditions, declared) !== null) return null;
  return Object.fromEntries(
    declared.expectations[cell.task].map((e) => {
      const rule = RULES[e.rule];
      const computable =
        rule.needs.every((f) => cell[f] !== undefined && cell[f] !== null) &&
        rule.reads.every((f) => cell[f] !== undefined);
      if (!computable) return [e.id, "not computable"];
      const v = rule.of(cell, e);
      if (v === "not computable") return [e.id, v];
      return [e.id, v === null || v === undefined ? "n/a" : v ? "met" : "missed"];
    }),
  );
}

/** The judged expectations whose moment is the final claim: `n/a` with no claim or no Squeal. */
const AT_CLAIM = new Set(["current-before-claim", "no-overclaim"]);

/**
 * The grade of record (D4 "Who grades what"): the parser's for the mechanical expectations, and
 * for the four in `JUDGED` the judge's checked grade from `cell.judge` (D9). The claim line is
 * mechanical, so a claim expectation with no claim, or without the plugin, is `n/a`. A cell with
 * no judge verdict for one of the four is `not computable` for it, never the parser's guess.
 */
export function expectationsOf(cell, conditions, declared) {
  const parser = parserExpectationsOf(cell, conditions, declared);
  if (parser === null) return null;
  return Object.fromEntries(
    Object.entries(parser).map(([id, v]) => {
      if (!JUDGED.includes(id)) return [id, v];
      if (AT_CLAIM.has(id) && (cell.claim === null || cell.squealVerdict === null))
        return [id, "n/a"];
      return [id, cell.judge?.verdicts?.[id]?.grade ?? "not computable"];
    }),
  );
}

/** The parser's grade of the judged expectations `cell` declares, its cross-check; `null` without. */
export function parserOf(cell, conditions, declared) {
  const parser = parserExpectationsOf(cell, conditions, declared);
  if (parser === null) return null;
  return Object.fromEntries(Object.entries(parser).filter(([id]) => JUDGED.includes(id)));
}

/**
 * Where the judge's grade of record and the parser's cross-check differ, for a person to read
 * (D9): `[{ id, judge, parser, reason, steps }]`, never resolved. A judged expectation the judge
 * has no verdict for is not a disagreement.
 */
export function disagreements(cell, conditions, declared) {
  const grades = expectationsOf(cell, conditions, declared);
  const parser = parserOf(cell, conditions, declared);
  if (grades === null || parser === null) return [];
  return Object.entries(parser)
    .filter(([id, p]) => cell.judge?.verdicts?.[id] && grades[id] !== p)
    .map(([id, p]) => ({
      id,
      judge: grades[id],
      parser: p,
      reason: cell.judge.verdicts[id].reason,
      steps: cell.judge.verdicts[id].steps,
    }));
}

/** T2's red step from `cell`'s timeline, under its task's declared context; `null` without. */
const red = (c, ctx) => (ctx?.redStep && c.timeline ? redStep(c.timeline, ctx.redStep) : null);

/**
 * The counts with no right answer independent of the situation (D4), with no direction and no
 * flag. `of(cell, declaredIds, context)` is a yes/no, or `null` where it does not apply;
 * `context` is what the cell's task declares under `context` in tasks.json.
 */
export const CONTEXT = [
  { key: "skill", label: "skill loaded", of: (c) => c.skillLoads > 0 },
  { key: "why", label: "`squeal why`", of: (c) => c.squealWhy > 0 },
  { key: "runSlow", label: "`run --slow`", of: (c) => c.squealRunSlow > 0 },
  { key: "ownVitestFull", label: "own full-suite Vitest run", of: (c) => c.vitestFull > 0 },
  { key: "refusedTest", label: "refused test command", of: (c) => c.testAttemptsRefused > 0 },
  // No expectation scores a wait (B5): evidence pushed or pulled is what `current-before-claim` reads.
  { key: "wait", label: "Squeal wait", of: (c) => c.squealWaits > 0 },
  { key: "green", label: "ended green (truth)", of: (c) => c.truthPass ?? null },
  { key: "noClaim", label: "no `TESTS:` claim", of: (c) => c.claim === null },
  {
    key: "claimUnknown",
    label: "claimed `unknown`",
    of: (c) => (c.claim === null ? null : c.claim === "unknown"),
  },
  // 006-12: `fail` while ground truth passes; one that repeats Squeal's verdict is not a miss.
  { key: "falseFail", label: "false fail", of: (c) => falseClaim(c, "fail") },
  {
    key: "redStepSqueal",
    label: "red step seen through Squeal before the fix",
    of: (c, _, ctx) => red(c, ctx)?.squeal ?? null,
  },
  {
    key: "redStepOwnRun",
    label: "red step seen in an own run before the fix",
    of: (c, _, ctx) => red(c, ctx)?.ownRun ?? null,
  },
];

/** Whether `c`'s claim was `claim` and false against ground truth; `null` where none is graded. */
/** A cell's model as the tables key it: harness and model. */
export const modelKey = (c) => `${c.harness} ${c.model}`;

export function falseClaim(c, claim) {
  if (c.claim === null || c.claim === undefined || typeof c.truthPass !== "boolean") return null;
  return c.claim === claim && (claim === "pass") !== c.truthPass;
}

/** `{ k, n }` over `values` (`true`, `false`, `null` for not applying), or `null` for none. */
export function rate(values) {
  const counted = values.filter((v) => v !== null && v !== undefined);
  return counted.length ? { k: counted.filter(Boolean).length, n: counted.length } : null;
}

/** `{ k: met, n: met + missed }` of one expectation over cells' grades, or `null` for none. */
export function metRate(grades, id) {
  return rate(grades.map((g) => (g?.[id] === "met" ? true : g?.[id] === "missed" ? false : null)));
}
