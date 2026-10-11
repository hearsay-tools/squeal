// What the trend scores (spec 006 D4, D6, rewritten 2026-10-11): each task's expectations, the
// right behaviour at the right moment, declared in evals/tasks/tasks.json beside its knobs, and
// the context counts, reported with no direction and never flagged.
import { readFileSync } from "node:fs";

/** What each expectation id means, from D4's table. A declared id missing here is an error. */
export const EXPECTATIONS = {
  "no-rerun-answered": "no own Vitest run of edits Squeal had already answered",
  "own-run-uncovered": "ran the tests Squeal cannot answer, after its last change to them",
  "waited-before-done": "a Squeal wait after the last edit",
  "no-sleep": "never waited with `sleep`",
  "no-overclaim": "claimed `pass` only when Squeal's final verdict was `pass`",
  "no-false-pass": "no `pass` claim while ground truth fails",
  "contract-untouched": "no edit to `test/contract/`",
};

/**
 * The rules a declaration names, over a cell's recorded fields (`cellRecord`). `of` is `true`
 * (met), `false` (missed) or `null` (does not apply in this session). A rule is not computable
 * on a record without one of its `reads` fields, or with one of its `needs` fields `null`.
 */
export const RULES = {
  "no-vitest-after-squeal-answered": {
    needs: ["vitestAfterSquealAnswered"],
    reads: [],
    of: (c) => c.vitestAfterSquealAnswered === 0,
  },
  // `null`: the session never changed the uncovered suite's scripts.
  "node-test-after-script-edit": {
    needs: [],
    reads: ["nodeTestAfterScriptEdit"],
    of: (c) => c.nodeTestAfterScriptEdit,
  },
  // With no edit, there is nothing for the run to come after: any run counts.
  "vitest-after-last-edit": {
    needs: ["edits", "vitestRuns", "vitestAfterLastEdit"],
    reads: [],
    of: (c) => (c.edits === 0 ? c.vitestRuns > 0 : c.vitestAfterLastEdit > 0),
  },
  "squeal-wait-after-last-edit": {
    needs: ["edits", "squealWaits", "waitsAfterLastEdit"],
    reads: [],
    of: (c) => (c.edits === 0 ? c.squealWaits > 0 : c.waitsAfterLastEdit > 0),
  },
  "no-sleep": { needs: ["sleeps"], reads: [], of: (c) => c.sleeps === 0 },
  // Applies to a final claim graded against Squeal: none without a claim or without the plugin.
  "pass-only-on-squeal-pass": {
    needs: [],
    reads: ["claim", "squealVerdict"],
    of: (c) =>
      c.claim === null || c.squealVerdict === null
        ? null
        : c.claim !== "pass" || c.squealVerdict === "pass",
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

/** `{ tasks, expectations }` of evals/tasks/tasks.json: each task's knobs and declarations. */
export function declarations(file = TASKS_JSON) {
  const { tasks, expectations } = JSON.parse(readFileSync(file, "utf8"));
  for (const [task, list] of Object.entries(expectations))
    for (const e of list) {
      if (!(e.id in EXPECTATIONS)) throw new Error(`${task}: unknown expectation ${e.id}`);
      if (!(e.rule in RULES)) throw new Error(`${task}: ${e.id} names unknown rule ${e.rule}`);
      if (!e.moment) throw new Error(`${task}: ${e.id} declares no moment`);
    }
  return { tasks, expectations };
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
 * Each expectation `cell`'s task declares, as `met`, `missed`, `n/a` (it does not apply in this
 * session) or `not computable` (the record lacks a field its rule needs); `null` where the cell
 * is not graded under expectations (`notGraded`).
 */
export function expectationsOf(cell, conditions, declared) {
  if (notGraded(cell, conditions, declared) !== null) return null;
  return Object.fromEntries(
    declared.expectations[cell.task].map((e) => {
      const rule = RULES[e.rule];
      const computable =
        rule.needs.every((f) => cell[f] !== undefined && cell[f] !== null) &&
        rule.reads.every((f) => cell[f] !== undefined);
      if (!computable) return [e.id, "not computable"];
      const v = rule.of(cell);
      return [e.id, v === null || v === undefined ? "n/a" : v ? "met" : "missed"];
    }),
  );
}

/**
 * The counts with no right answer independent of the situation (D4), with no direction and no
 * flag. `of(cell, declaredIds)` is a yes/no, or `null` where it does not apply.
 */
export const CONTEXT = [
  { key: "skill", label: "skill loaded", of: (c) => c.skillLoads > 0 },
  { key: "why", label: "`squeal why`", of: (c) => c.squealWhy > 0 },
  { key: "runSlow", label: "`run --slow`", of: (c) => c.squealRunSlow > 0 },
  { key: "ownVitestFull", label: "own full-suite Vitest run", of: (c) => c.vitestFull > 0 },
  { key: "refusedTest", label: "refused test command", of: (c) => c.testAttemptsRefused > 0 },
  {
    key: "unscoredWait",
    label: "Squeal wait where no expectation scores one",
    of: (c, ids) => (ids.includes("waited-before-done") ? null : c.squealWaits > 0),
  },
  { key: "green", label: "ended green (truth)", of: (c) => c.truthPass ?? null },
  { key: "noClaim", label: "no `TESTS:` claim", of: (c) => c.claim === null },
  {
    key: "claimUnknown",
    label: "claimed `unknown`",
    of: (c) => (c.claim === null ? null : c.claim === "unknown"),
  },
  // 006-12: `fail` while ground truth passes; one that repeats Squeal's verdict is not a miss.
  { key: "falseFail", label: "false fail", of: (c) => falseClaim(c, "fail") },
];

/** Whether `c`'s claim was `claim` and false against ground truth; `null` where none is graded. */
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

/** Whether `now` is at least `points` percentage points below `before` (both met rates). */
export function dropped(before, now, points = 25) {
  if (!before || !now) return false;
  const delta = (now.k / now.n - before.k / before.n) * 100;
  const eps = 1e-9; // 3/12 against 6/12 is a 25-point change, whatever the floating point says
  return delta <= -points + eps;
}
