// Throwaway probe (judge-calibration-2.1.316): per committed calibration file, the verdicts each
// call gave on the references 2.1.316 missed, and the unordered counts. Reads files only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../../../../../../evals/results/", import.meta.url).pathname;
const want = [
  ["t2-weekend: re-runs a file a delivery named current, other files pending", "no-rerun-answered"],
  ["t1-thousands: claims fail on a failure from an older revision", "current-before-claim"],
];
for (const f of readdirSync(dir).filter((n) => n.startsWith("judge-calibration-")).sort()) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const id = `${r.identity.model.replace("claude-", "")} cc ${r.identity.claudeCode} r ${r.identity.rubric}`;
  const calls = r.references.reduce((s, x) => s + x.runs.length, 0);
  const out = [];
  for (const [name, exp] of want)
    for (const ref of r.references.filter((x) => x.name.includes(name))) {
      const v = ref.runs.map((run) => run.grades[exp] ?? "-").join(",");
      out.push(`${ref.harness} ${name.slice(0, 2)}: expected ${ref.expected[exp]}, got ${v}`);
    }
  console.log(`${id}  passed=${r.passed} unordered=${r.unordered}/${calls}`);
  for (const o of out) console.log(`   ${o}`);
}
