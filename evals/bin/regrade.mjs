#!/usr/bin/env node
// Re-applies the claim grading of 006-12 to committed results files, then regenerates TREND.md:
//   node evals/bin/regrade.mjs [dir] [--date YYYY-MM-DD]
// `dir` defaults to evals/results. Each cell's `claim` is re-read from its `claimLine` with the
// current parser, and `claimTrue` and `claimMatchesSqueal` are recomputed from it, `truthPass`
// and `squealVerdict` by the grader's own rule; nothing else changes. Each file gets a `regraded`
// note naming the cells it changed, an empty list where it changed none. Grading is not a
// condition, so the fingerprint stays.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gradeClaim, parseClaim } from "../lib/claim.mjs";
import { EVALS } from "../lib/prepare.mjs";
import { trendMarkdown } from "../lib/trend.mjs";

const BY = "006-12";
const NOTE =
  "Claims re-read from claimLine: one claim word followed by `|` and evidence is now a claim, and a line naming two claim words is still none. claimTrue and claimMatchesSqueal recomputed from claim, truthPass and squealVerdict; the trend now splits a false claim into false pass and false fail. The 006-12 `command -p`, `-v` and `-V` parsing fix is not applied: results files keep no transcripts, so every other count is as first graded.";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { date: { type: "string", default: new Date().toISOString().slice(0, 10) } },
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

// Every file is regraded before any is written, so a refusal leaves them all as they were.
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
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
for (const { f, data, changed, write } of runs) {
  if (write) writeFileSync(join(dir, f), `${JSON.stringify(data, null, 1)}\n`);
  console.log(`${f}: ${changed.length ? `regraded ${changed.join(", ")}` : "unchanged"}`);
}
writeFileSync(join(dir, "TREND.md"), trendMarkdown(runs));
console.log(`TREND.md from ${runs.length} results file(s)`);
