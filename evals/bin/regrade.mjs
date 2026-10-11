#!/usr/bin/env node
// Re-applies the claim grading of 006-12 and the expectations of evals/tasks/tasks.json (spec 006
// D4, 006-14) to committed results files, then regenerates TREND.md:
//   node evals/bin/regrade.mjs [dir] [--date YYYY-MM-DD]
// `dir` defaults to evals/results. Each cell's `claim` is re-read from its `claimLine` with the
// current parser, and `claimTrue` and `claimMatchesSqueal` are recomputed from it, `truthPass`
// and `squealVerdict` by the grader's own rule. Then each cell's `expectations` are computed from
// its kept fields and its retained timeline (D4), and the file records the expectations revision
// that graded it. A rule a cell lacks a field or a timeline for is `not computable`, and a task
// whose run had other knobs is not graded;
// both are named in the note, never guessed. Nothing else changes. Each file gets a `regraded`
// note per change, naming the cells it changed, an empty list where it changed none. Grading is
// not a condition, so the fingerprint stays.
//
// The four judged expectations (D4 "Who grades what", D9) are read from each cell's cached judge
// verdicts, and the parser's grade beside them is refreshed. Only with --judge does it call a
// model: each cell with a retained transcript whose verdicts are from another identity is judged
// again by the calibrated identity (evals/bin/judge-calibrate.mjs), in an isolated `claude -p`;
// the cache is reused otherwise. A cell without a transcript stays not computable for the four.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { declarations, expectationsOf, notGraded, parserOf } from "../lib/behaviours.mjs";
import { calibratedIdentity, judgeRecord } from "../lib/calibration.mjs";
import { gradeClaim, parseClaim } from "../lib/claim.mjs";
import { claudeRunner, identityKey } from "../lib/judge.mjs";
import { EVALS } from "../lib/prepare.mjs";
import { expectationsRevision, trendMarkdown } from "../lib/trend.mjs";

const BY = "006-12";
const NOTE =
  "Claims re-read from claimLine: one claim word followed by `|` and evidence is now a claim, and a line naming two claim words is still none. claimTrue and claimMatchesSqueal recomputed from claim, truthPass and squealVerdict; the trend now splits a false claim into false pass and false fail. The 006-12 `command -p`, `-v` and `-V` parsing fix is not applied: results files keep no transcripts, so every other count is as first graded.";

const EXPECTED =
  "Expectations (spec 006 D4 as amended 2026-10-11) computed from each cell's kept fields under evals/tasks/tasks.json at this revision: met, missed, n/a where one does not apply. The trend scores these, never raw behaviours. no-rerun-answered, own-run-uncovered, current-before-claim and no-overclaim read the cell's retained timeline (006-17): the evidence the agent had seen, when, and which tests its own runs completed; since 006-19 also each check's own provenance and identity, and each run's filters and failed checks. A cell without a timeline, as every cell graded before 006-17 is, is not computable for them, never guessed from its counts or from the runner's end status; measuring them needs a new run. Since 006-23 (D9) a judge grades those four from the cell's retained transcript, and the parser's grade is kept beside it as `parser`; a cell without a transcript or a judge verdict is not computable for them. A cell whose run had other knobs for its task is not graded. Both are listed here.";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: new Date().toISOString().slice(0, 10) },
    judge: { type: "boolean", default: false },
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

/** The note of the expectations pass over `data`: what changed and what could not be graded. */
function expect(data) {
  const changed = [];
  const notGradedTasks = {};
  const notComputable = {};
  for (const cell of data.cells) {
    const next = expectationsOf(cell, data.conditions, declared);
    if (JSON.stringify(cell.expectations) !== JSON.stringify(next)) {
      cell.expectations = next;
      changed.push(cell.id);
    }
    const why = notGraded(cell, data.conditions, declared);
    if (why !== null) notGradedTasks[cell.task] = why;
    for (const [id, v] of Object.entries(next ?? {}))
      if (v === "not computable") notComputable[id] = [...(notComputable[id] ?? []), cell.id];
  }
  const earlier = (data.regraded ?? []).find(
    (n) => n.by === "expectations" && n.revision === revision,
  );
  if (changed.length === 0 && earlier && data.expectationsRevision === revision) return false;
  data.expectationsRevision = revision;
  const others = (data.regraded ?? []).filter((n) => n !== earlier);
  const all = [...new Set([...(earlier?.changed ?? []), ...changed])];
  data.regraded = [
    ...others,
    {
      by: "expectations",
      revision,
      date: changed.length || !earlier ? values.date : earlier.date,
      changed: all,
      notGraded: Object.entries(notGradedTasks).map(([task, why]) => ({ task, why })),
      notComputable,
      note: EXPECTED,
    },
  ];
  return true;
}

const runner = values.judge ? claudeRunner() : null;
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
 * with --judge), and refreshes the parser's grade beside every judged cell. The changed ids.
 */
async function judge(data) {
  const changed = [];
  for (const cell of data.cells) {
    if (notGraded(cell, data.conditions, declared) !== null) continue;
    if (identity && cell.transcript) {
      const next = await judgeRecord(cell, {
        identity,
        runner,
        declared,
        conditions: data.conditions,
      });
      if (JSON.stringify(next.judge) !== JSON.stringify(cell.judge)) changed.push(cell.id);
      Object.assign(cell, next);
    } else if (cell.judge) cell.parser = parserOf(cell, data.conditions, declared);
  }
  if (!changed.length) return false;
  data.regraded = [
    ...(data.regraded ?? []),
    { by: "judge", identity: identityKey(identity), date: values.date, changed },
  ];
  return true;
}

// Every file is regraded before any is written, so a refusal leaves them all as they were.
// The judge's calibration files (D9) live beside the results and are not regraded.
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("judge-calibration-"))
  .map((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const changed = [];
    for (const cell of data.cells) {
      const next = regradeCell(cell);
      if (Object.entries(next).some(([k, v]) => cell[k] !== v)) {
        Object.assign(cell, next);
        changed.push(cell.id);
      }
    }
    const earlier = (data.regraded ?? []).find((n) => n.by === BY);
    const write = changed.length > 0 || !earlier;
    if (write) {
      const others = (data.regraded ?? []).filter((n) => n.by !== BY);
      const all = [...new Set([...(earlier?.changed ?? []), ...changed])];
      data.regraded = [...others, { by: BY, date: values.date, changed: all, note: NOTE }];
    }
    return { f, name: f.replace(/\.json$/, ""), data, changed, write };
  });
for (const r of runs) {
  const judged = await judge(r.data);
  r.write = expect(r.data) || judged || r.write;
}
for (const { f, data, changed, write } of runs) {
  if (write) writeFileSync(join(dir, f), `${JSON.stringify(data, null, 1)}\n`);
  const note = data.regraded.findLast((n) => n.by === "expectations");
  console.log(
    `${f}: claims ${changed.length ? `regraded ${changed.join(", ")}` : "unchanged"}; expectations ${note.revision}, ${note.changed.length} cell(s) changed, not graded: ${note.notGraded.map((n) => n.task).join(", ") || "none"}`,
  );
}
writeFileSync(join(dir, "TREND.md"), trendMarkdown(runs, declared));
console.log(`TREND.md from ${runs.length} results file(s)`);
