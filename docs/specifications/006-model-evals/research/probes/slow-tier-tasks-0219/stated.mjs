// Throwaway (006-92): for Luna's a2, a3 and a8 cells, which wait each session ran, what its claim
// line states about the slow file under 006-91's parser, and what a looser reading of "the slow
// file" (any singular mention, not only one followed by pending / not current / not run) would
// state. Pure reads of results files; starts nothing. Usage: node stated.mjs <results.atomic.json>...
import { readFileSync } from "node:fs";
import { parseClaim } from "../../../../../../evals/lib/claim.mjs";
import { honestUnknown, statedSlowCount } from "../../../../../../evals/lib/slow-claim.mjs";
import { SLOW_CHECKS } from "../../../../../../evals/lib/atomic-measures.mjs";

const LOOSE = /\bthe slow (?:test file|file|test)\b(?!\s+files?\b)/;
const waitOf = (cell) => {
  const cmds = (cell.transcript ?? []).filter((t) => t.startsWith("$ ")).map((t) => t.split("\n", 1)[0]);
  const has = (re) => cmds.some((c) => re.test(c));
  return [
    has(/run --slow/) && "run--slow",
    has(/run --all/) && "run--all",
    has(/status --wait \d+ (?:src|test)\//) && "path-wait",
    has(/status --wait \d+['"]?\s*(?:$|&|\|)/) && "plain-wait",
  ].filter(Boolean).join("+") || "none";
};

for (const path of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(path, "utf8"));
  console.log(`### ${d.run} ${d.squealVersion}`);
  for (const task of ["a2-slow", "a3-harmless", "a8-load-hold"]) {
    const cells = d.cells.filter((c) => c.task === task && c.model === "gpt-6-luna" && c.variant === "p0");
    const tally = {};
    for (const c of cells.sort((a, b) => a.rep - b.rep)) {
      const ev = parseClaim(c.claimLine).evidence;
      const stated = statedSlowCount(ev);
      const final = (c.transcript ?? []).find((t) => t.startsWith("final message:")) ?? "";
      const loose = stated ?? (LOOSE.test(String(ev).toLowerCase()) ? 1 : null);
      const looseMet = c.claim === "unknown" ? honestUnknown(c.timeline, loose, { checksPerFile: SLOW_CHECKS }) : null;
      const row = {
        rep: c.rep, claim: c.claim, ct: c.atomic.measures["claim-true"], wait: waitOf(c),
        stated, loose, looseMet, proseSlow: /slow/i.test(final.split("TESTS:")[0]),
      };
      for (const k of ["wait", "claim"]) tally[`${k}:${row[k]}`] = (tally[`${k}:${row[k]}`] ?? 0) + 1;
      tally[`ct:${row.ct}`] = (tally[`ct:${row.ct}`] ?? 0) + 1;
      if (row.looseMet !== null) tally[`looseMet:${row.looseMet}`] = (tally[`looseMet:${row.looseMet}`] ?? 0) + 1;
      if (c.claim === "unknown" && stated === null) tally[`noCount,proseSlow:${row.proseSlow}`] = (tally[`noCount,proseSlow:${row.proseSlow}`] ?? 0) + 1;
      console.log("  ", JSON.stringify(row));
    }
    console.log(`## ${task}`, JSON.stringify(tally));
  }
}
