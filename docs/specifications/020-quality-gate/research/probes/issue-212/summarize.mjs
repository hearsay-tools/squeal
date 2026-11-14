// Throwaway (row 020-56): one line of facts per gate run from /tmp/issue-212/out/<step>.{stdout,load}.
// Usage: node summarize.mjs <out dir> <step>... ; prints JSON.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...steps] = process.argv.slice(2);
const rows = steps.map((step) => {
  const r = JSON.parse(readFileSync(join(dir, `${step}.stdout`), "utf8"));
  const load = readFileSync(join(dir, `${step}.load`), "utf8");
  const num = (re) => Number(load.match(re)?.[1]);
  const functions = {};
  for (const f of r.functions) {
    const k = `${f.path} ${f.state}${f.gap ? ` ${f.gap}` : ""} loaders=${f.loaders.measured.length}/${f.loaders.expected.length} crap=${f.crap}`;
    functions[k] = (functions[k] ?? 0) + 1;
  }
  return {
    step,
    load1mBefore: num(/before (\S+)/),
    load1mAfter: num(/after (\S+)/),
    exit: num(/exit (\d+)/),
    wallSeconds: Math.round(num(/wall (\S+)/) * 10) / 10,
    verdict: r.verdict,
    counts: r.counts,
    budget: r.budget,
    runs: r.runs.map((x) => ({
      runner: x.runner,
      selected: x.selected?.length,
      notFinished: x.notFinished?.length ?? 0,
      overBudget: x.overBudget?.length ?? 0,
      failed: x.failed?.length ?? 0,
      durationMs: x.durationMs,
    })),
    functions,
  };
});
console.log(JSON.stringify(rows, null, 1));
