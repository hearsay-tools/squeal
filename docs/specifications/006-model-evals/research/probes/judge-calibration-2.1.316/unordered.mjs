// Throwaway probe (judge-calibration-2.1.316): across every committed calibration file, how many
// verdicts were flagged `unordered` and how often a flagged and an unflagged verdict missed its
// expected grade. Reads files only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../../../../../../evals/results/", import.meta.url).pathname;
const tally = {};
for (const f of readdirSync(dir).filter((n) => n.startsWith("judge-calibration-")).sort()) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const m = r.identity.model.replace("claude-", "");
  const key = `${m} cc ${r.identity.claudeCode} r ${r.identity.rubric}`;
  const t = (tally[key] ??= { calls: 0, callsFlagged: 0, verdicts: 0, flagged: 0, wrongFlagged: 0, wrongOrdered: 0, callsAllFlagged: 0 });
  for (const ref of r.references)
    for (const run of ref.runs) {
      t.calls++;
      const fl = run.unordered ?? [];
      if (fl.length) t.callsFlagged++;
      if (fl.length && fl.length === Object.keys(run.verdicts).length) t.callsAllFlagged++;
      for (const [id, exp] of Object.entries(ref.expected)) {
        if (!(id in run.verdicts)) continue;
        t.verdicts++;
        const wrong = run.grades[id] !== exp;
        if (fl.includes(id)) { t.flagged++; if (wrong) t.wrongFlagged++; } else if (wrong) t.wrongOrdered++;
      }
    }
}
console.log("identity | calls | calls flagged | calls with every verdict flagged | verdicts | flagged | wrong flagged | wrong unflagged");
for (const [k, t] of Object.entries(tally))
  console.log(`${k} | ${t.calls} | ${t.callsFlagged} | ${t.callsAllFlagged} | ${t.verdicts} | ${t.flagged} | ${t.wrongFlagged} | ${t.wrongOrdered}`);
