#!/usr/bin/env node
// Re-applies the claim grading of 006-12 and the expectations of evals/tasks/tasks.json (spec 006
// D4, 006-14) to committed baseline and variant results files, then regenerates TREND.md:
//   node evals/bin/regrade.mjs [dir] [--by <row> --note <text>] [--date YYYY-MM-DD]
// `dir` defaults to evals/results. Each cell's `claim` is re-read from its `claimLine` with the
// current parser, and `claimTrue` and `claimMatchesSqueal` are recomputed from it, `truthPass`
// and `squealVerdict` by the grader's own rule. Then each cell's `expectations` are computed from
// its kept fields and its retained timeline (D4), and the file records the expectations revision
// that graded it. A rule a cell lacks a field or a timeline for is `not computable`, and a task
// whose run had other knobs is not graded;
// both are named in the note, never guessed. Nothing else changes. Only a file where a claim, an
// expectation or a judge verdict changed is written (006-86), with a `regraded` note per pass that
// changed it, naming those cells: the claim pass's is `{ by, date, changed, note }` from --by and
// --note, which a run that changes a claim needs; the expectations pass's names its revision.
// Grading is not a condition, so the fingerprint stays. TREND.md is regenerated only when a file
// was written.
//
// The four judged expectations (D4 "Who grades what", D9) are read from each cell's cached judge
// verdicts, and the parser's grade beside them is refreshed. Only with --judge does it call a
// model: each cell with a retained transcript whose verdicts are from another identity is judged
// again by the calibrated identity (evals/bin/judge-calibrate.mjs), in an isolated `claude -p`;
// the cache is reused otherwise. A cell without a transcript stays not computable for the four.
// --max-cost <usd> stops calling the model once the calls so far cost that much; a regrade that
// reached it writes nothing.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { declarations, expectationsOf, notGraded, parserOf } from "../lib/behaviours.mjs";
import { calibratedIdentity, judgeRecord } from "../lib/calibration.mjs";
import { gradeClaim, parseClaim } from "../lib/claim.mjs";
import { claudeRunner, identityKey } from "../lib/judge.mjs";
import { EVALS } from "../lib/prepare.mjs";
import { stamped } from "../lib/results.mjs";
import { stopOnSignal } from "../lib/session.mjs";
import { expectationsRevision, writeTrendMarkdown } from "../lib/trend.mjs";

const EXPECTED =
  "Expectations (spec 006 D4 as amended 2026-10-11) computed from each cell's kept fields under evals/tasks/tasks.json at this revision: met, missed, n/a where one does not apply. The trend scores these, never raw behaviours. no-rerun-answered, own-run-uncovered, current-before-claim and no-overclaim read the cell's retained timeline (006-17): the evidence the agent had seen, when, and which tests its own runs completed; since 006-19 also each check's own provenance and identity, and each run's filters and failed checks. A cell without a timeline, as every cell graded before 006-17 is, is not computable for them, never guessed from its counts or from the runner's end status; measuring them needs a new run. Since 006-23 (D9) a judge grades those four from the cell's retained transcript, and the parser's grade is kept beside it as `parser`; a cell without a transcript or a judge verdict is not computable for them. A cell whose run had other knobs for its task is not graded. Both are listed here.";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    by: { type: "string" },
    note: { type: "string" },
    date: { type: "string", default: new Date().toISOString().slice(0, 10) },
    judge: { type: "boolean", default: false },
    "max-cost": { type: "string" },
  },
});
const dir = positionals[0] ?? join(EVALS, "results");

/**
 * Squeal's end state as the grader saw it, from the kept fields: `null` without the plugin. An
 * unsupported status's verdict is `unknown` too, and only the old grade of an `unknown` claim
 * tells the two apart; `supported` is `null` where nothing does.
 */
function squealOf(cell) {
  const verdict = cell.squealVerdict ?? null;
  if (verdict === null) return null;
  if (verdict !== "unknown") return { verdict, supported: true };
  return {
    verdict,
    supported: cell.claim === "unknown" ? cell.claimMatchesSqueal === true : null,
  };
}

function regradeCell(cell) {
  const { claim } = parseClaim(cell.claimLine);
  const squeal = squealOf(cell);
  if (claim === "unknown" && squeal?.supported === null)
    throw new Error(
      `${cell.id}: an \`unknown\` claim against Squeal's \`unknown\`, and whether that status was supported is not kept`,
    );
  const { claimTrue, claimMatchesSqueal } = gradeClaim({
    claim,
    truthPass: cell.truthPass ?? null,
    squeal,
  });
  return { claim, claimTrue, claimMatchesSqueal };
}

const declared = declarations();
const revision = expectationsRevision(declared);

/**
 * The expectations pass over `data`: the cells whose expectations changed and the tasks not
 * graded. Only where a cell changed is `data` stamped with the pass's note, naming what could not
 * be graded too.
 */
function expect(data) {
  const changed = [];
  const notGradedTasks = {};
  const notComputable = {};
  for (const cell of data.cells) {
    const why = notGraded(cell, data.conditions, declared);
    const next = expectationsOf(cell, data.conditions, declared);
    // The parser's grade beside a judge verdict (D9) is refreshed with them.
    const parser =
      cell.judge && why === null ? parserOf(cell, data.conditions, declared) : undefined;
    if (
      JSON.stringify(cell.expectations) !== JSON.stringify(next) ||
      (parser !== undefined && JSON.stringify(cell.parser) !== JSON.stringify(parser))
    ) {
      cell.expectations = next;
      if (parser !== undefined) cell.parser = parser;
      changed.push(cell.id);
    }
    if (why !== null) notGradedTasks[cell.task] = why;
    for (const [id, v] of Object.entries(next ?? {}))
      if (v === "not computable") notComputable[id] = [...(notComputable[id] ?? []), cell.id];
  }
  const notGradedList = Object.entries(notGradedTasks).map(([task, why]) => ({ task, why }));
  if (changed.length) {
    data.expectationsRevision = revision;
    data.regraded = stamped(data.regraded, {
      by: "expectations",
      revision,
      date: values.date,
      changed,
      notGraded: notGradedList,
      notComputable,
      note: EXPECTED,
    });
  }
  return { changed, notGraded: notGradedList };
}

const maxCost = values["max-cost"] === undefined ? Infinity : Number(values["max-cost"]);
// 006-98: with --judge, SIGINT or SIGTERM ends each judge call in flight with the script.
if (values.judge) stopOnSignal();
const real = values.judge ? claudeRunner() : null;
let spent = 0;
let capped = false;
/** The real runner until the calls so far cost `maxCost`, then a refusal. */
const runner = real
  ? async (call) => {
      if (spent >= maxCost) {
        capped = true;
        return { status: 1, stdout: "", stderr: `--max-cost $${maxCost} reached, not called` };
      }
      const r = await real(call);
      try {
        spent += JSON.parse(r.stdout).total_cost_usd ?? 0;
      } catch {}
      return r;
    }
  : null;
const identity = values.judge
  ? await calibratedIdentity({ dir: join(EVALS, "results"), declared, runner })
  : null;
if (values.judge && identity === null) {
  console.error(
    "--judge: no judge identity has passed calibration for this Claude Code and rubric; run evals/bin/judge-calibrate.mjs",
  );
  process.exit(1);
}

/**
 * Re-judges `data`'s cells with a transcript whose cached verdicts are another identity's (only
 * with --judge). Whether a verdict changed.
 */
async function judge(data) {
  const changed = [];
  if (!identity) return false;
  for (const cell of data.cells) {
    if (notGraded(cell, data.conditions, declared) !== null) continue;
    if (cell.transcript) {
      const next = await judgeRecord(cell, {
        identity,
        runner,
        declared,
        conditions: data.conditions,
      });
      if (JSON.stringify(next.judge) !== JSON.stringify(cell.judge)) changed.push(cell.id);
      Object.assign(cell, next);
    }
  }
  if (!changed.length) return false;
  data.regraded = [
    ...(data.regraded ?? []),
    { by: "judge", identity: identityKey(identity), date: values.date, changed },
  ];
  return true;
}

// Every file is regraded before any is written, so a refusal leaves them all as they were.
// Only baseline and variant files are regraded, as the trend reads them: the judge's calibration
// files (D9) and the atomic tier's files (D10, regraded by atomic-regrade.mjs) are left as they are.
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ f, data: JSON.parse(readFileSync(join(dir, f), "utf8")) }))
  .filter(({ data }) => data.kind === "baseline" || data.kind === "variant")
  .map(({ f, data }) => {
    const changed = [];
    for (const cell of data.cells) {
      const next = regradeCell(cell);
      if (Object.entries(next).some(([k, v]) => cell[k] !== v)) {
        Object.assign(cell, next);
        changed.push(cell.id);
      }
    }
    if (changed.length)
      data.regraded = stamped(data.regraded, {
        by: values.by,
        date: values.date,
        changed,
        note: values.note,
      });
    return { f, data, changed };
  });
const claimed = runs.filter((r) => r.changed.length);
if (claimed.length && (!values.by || !values.note)) {
  console.error(
    `claims changed in ${claimed.map((r) => r.f).join(", ")}: name the row and the change with --by <row> --note <text>; nothing written`,
  );
  process.exit(2);
}
for (const r of runs) {
  const judged = await judge(r.data);
  r.expected = expect(r.data);
  r.write = r.changed.length > 0 || judged || r.expected.changed.length > 0;
}
if (capped) {
  console.error(`--max-cost $${maxCost} reached after $${spent.toFixed(4)}; nothing written`);
  process.exit(1);
}
if (values.judge) console.log(`judge calls cost $${spent.toFixed(4)}`);
for (const { f, data, changed, expected, write } of runs) {
  if (write) writeFileSync(join(dir, f), `${JSON.stringify(data, null, 1)}\n`);
  console.log(
    `${f}: ${write ? "written" : "unchanged, not written"}; claims ${changed.length ? `regraded ${changed.join(", ")}` : "unchanged"}; expectations ${revision}, ${expected.changed.length} cell(s) changed, not graded: ${expected.notGraded.map((n) => n.task).join(", ") || "none"}`,
  );
}
if (runs.some((r) => r.write)) {
  const n = writeTrendMarkdown(dir, declared);
  console.log(`TREND.md from ${n} baseline results file(s)`);
}
