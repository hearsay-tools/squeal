// The condensed per-case table of the lessons section, from measure.mjs's JSON lines.
import { readFileSync } from "node:fs";
const labels = { "a-idle": "(a) idle", "a-idle+8": "(a) idle, +8 burners", "b-baseline": "(b) baseline", "c-backlog": "(c) `run --all --force`", "c-env": "(c) backlog after a config edit", "d-slow": "(d) slow file running" };
const order = Object.keys(labels);
const s = (ms) => (ms / 1000).toFixed(1);
const med = (v) => { v = v.filter((x) => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const parts = { watcher: "watcher", runnerPart: "runner part", queueWait: "queue wait", tierStart: "tier start", run: "tier run", record: "record" };
console.log("| repo | case | load | n | result, run (median, max) | result, lookup (median) | `--wait` with news (median) | `--wait` without news | dominant stage of the result | stale quiet |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const repo of process.argv.slice(2)) {
  const rows = readFileSync(`/tmp/sq172/${repo}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const c of order) {
    const rs = rows.filter((r) => r.case === c);
    if (rs.length === 0) continue;
    const runs = rs.filter((r) => !r.hitAt && r.run);
    const looks = rs.filter((r) => r.hitAt);
    const stale = rs.filter((r) => r.wait.revision < r.revision.number).length;
    const news = rs.filter((r) => r.mode !== "neutral" && r.wait.revision >= r.revision.number && r.wait.outcome === "news").map((r) => r.stages.waitReturned);
    const noNews = rs.filter((r) => r.mode === "neutral" && r.wait.revision >= r.revision.number).map((r) => `${s(r.stages.waitReturned)} (${r.wait.outcome})`);
    const res = runs.map((r) => r.stages.resultAfterEdit);
    const dom = Object.entries(parts).map(([k, name]) => [name, med(runs.map((r) => r.stages[k]))]).sort((a, b) => b[1] - a[1])[0];
    const loads = rs.map((r) => r.load0).sort((a, b) => a - b);
    console.log(`| ${repo} | ${labels[c]} | ${Math.round(loads[0])} to ${Math.round(loads.at(-1))} | ${rs.length} | ${s(med(res))}, ${s(Math.max(...res))} | ${looks.length ? s(med(looks.map((r) => r.stages.resultAfterEdit))) : "-"} | ${news.length ? s(med(news)) : "-"} | ${noNews.join(", ") || "-"} | ${dom[0]} (${s(dom[1])}) | ${stale} of ${rs.length} |`);
  }
}
