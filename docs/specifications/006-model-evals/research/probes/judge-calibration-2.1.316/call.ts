// Throwaway probe (judge-calibration-2.1.316): judges one calibration reference `n` times through
// the library (`judgeCell` with `claudeRunner`, which builds the judge's own scratch HOME under
// the eval root), keeps each call's raw stdout in out/, and prints the key order of every verdict
// object as the model returned it. Haiku or Sonnet only. Never runs anything under evals/bin.
// Usage: tsx call.ts <claude-haiku-5-5|claude-sonnet-5-5> "<reference name>" <n>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { claudeRunner, claudeVersion, JUDGE, JUDGED, judgeCell, judgeIdentity } from "../../../../../../evals/lib/judge.mjs";
import { calibrationReferences } from "../../../../../../test/evals/judge-references.ts";

const [model, name, n] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 1)];
if (!["claude-haiku-5-5", "claude-sonnet-5-5"].includes(model)) throw new Error("Haiku or Sonnet only");
if (!(n >= 1 && n <= 8)) throw new Error("1 to 8 calls per invocation");
const declared = JSON.parse(readFileSync(new URL("../../../../../../evals/tasks/tasks.json", import.meta.url), "utf8"));
const ref = calibrationReferences(JUDGED, declared).find((r) => r.name === name);
if (!ref) throw new Error(`no reference named ${name}`);
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const real = claudeRunner();
let raw = "";
const runner = async (call: { args: string[]; input?: string }) => {
  const r = await real(call);
  raw = r.stdout;
  return r;
};
const claudeCode = await claudeVersion(runner);
const identity = judgeIdentity({ model, effort: JUDGE.effort, claudeCode, declared });
console.log(`identity ${JSON.stringify(identity)}; reference ${ref.name}; expected ${JSON.stringify(ref.expected)}`);
let total = 0;
for (let i = 1; i <= n; i++) {
  const j = await judgeCell({ task: ref.task, transcript: ref.cell.transcript, claim: ref.cell.claim, declared, identity, runner });
  const stamp = `${model.replace("claude-", "")}-${ref.harness}-${ref.task}-${Date.now()}`;
  writeFileSync(`${out}${stamp}.json`, raw);
  let order = "unparsed";
  try {
    const r = JSON.parse(raw);
    const so = r.structured_output ?? (typeof r.result === "string" ? JSON.parse(r.result) : null);
    order = Object.entries(so ?? {}).map(([id, v]) => `${id}: ${Object.keys(v as object).join(",")}`).join(" | ");
  } catch {}
  total += j.cost ?? 0;
  const grades = Object.fromEntries(Object.entries(j.verdicts).map(([id, v]) => [id, (v as { grade: string }).grade]));
  const wrong = Object.entries(ref.expected).filter(([id, e]) => grades[id] !== e).map(([id]) => id);
  console.log(`call ${i}: cost $${j.cost}; ${wrong.length ? `WRONG ${wrong.join(",")}` : "as expected"}; unordered ${JSON.stringify(j.unordered ?? [])}${j.error ? `; error ${j.error}` : ""}`);
  console.log(`  order: ${order}`);
  for (const id of wrong) console.log(`  ${id}: ${j.verdicts[id].verdict} ${JSON.stringify(j.verdicts[id].steps)} ${j.verdicts[id].reason}`);
  console.log(`  file out/${stamp}.json`);
}
console.log(`total $${total.toFixed(6)}`);
