// The group reps' commit daemon tree: memory in the 20 s before the group (after its 60 s
// idle GC) and after the group. Usage: node gmem.mjs <out dir>
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const MiB = (kb) => Math.round(kb / 1024);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
for (const label of ["group-1", "group-2", "group-3"]) {
  const t = JSON.parse(readFileSync(`${dir}/${label}.times.json`, "utf8"));
  const lines = readFileSync(`${dir}/${label}.samples.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const pid = lines.find((l) => l.event?.startsWith("claimed:")).pid;
  const s = lines.filter((l) => l.trees).map((l) => ({ t: l.t, tr: l.trees.find((x) => x.pid === pid) })).filter((x) => x.tr);
  const gc = s.filter((x) => x.t > t.g0 - 20000 && x.t < t.g0 - 500);
  const after = s.filter((x) => x.t > t.g1 + 1000 && x.t < t.s0);
  const r = (a, k) => MiB(med(a.map((x) => x.tr[k])));
  console.log(label, "idle-after-GC (20 s before group) rss", r(gc, "rssKb"), "pss", r(gc, "pssKb"), "daemon rss", r(gc, "daemonRssKb"), "| after group rss", r(after, "rssKb"), "pss", r(after, "pssKb"), JSON.stringify(Object.fromEntries(Object.entries(gc.at(-1).tr.roles).map(([k, v]) => [k, MiB(v.rssKb)]))));
}
