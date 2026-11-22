// Memory of the commit daemons in three.samples.jsonl: per phase, sum of the commit daemon trees.
import { readFileSync } from "node:fs";
const [samplesF, marksF] = process.argv.slice(2);
const lines = readFileSync(samplesF, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const marks = Object.fromEntries(readFileSync(marksF, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((m) => [m.event, m.t]));
const pids = new Set(lines.filter((l) => l.event?.startsWith("claimed:")).map((l) => l.pid));
const MiB = (kb) => Math.round(kb / 1024);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const samples = lines.filter((l) => l.trees).map((l) => {
  const c = l.trees.filter((t) => pids.has(t.pid));
  const w = l.trees.filter((t) => !pids.has(t.pid));
  return { t: l.t, n: c.length, rss: c.reduce((a, t) => a + t.rssKb, 0), pss: c.reduce((a, t) => a + t.pssKb, 0), per: c.map((t) => t.rssKb), perPss: c.map((t) => t.pssKb), wt: w.reduce((a, t) => a + t.rssKb, 0), avail: l.availKb, members: c.map((t) => t.members) };
});
const phase = (name, a, b) => {
  const s = samples.filter((x) => x.t >= a && x.t <= b && x.n > 0);
  if (!s.length) return console.log(name, "no samples");
  const peak = s.reduce((m, x) => (x.rss > m.rss ? x : m));
  const peakPss = Math.max(...s.map((x) => x.pss));
  console.log(`${name}: ${((b - a) / 1000).toFixed(0)} s, daemons ${Math.max(...s.map((x) => x.n))}; sum RSS median ${MiB(med(s.map((x) => x.rss)))} peak ${MiB(peak.rss)} MiB; sum PSS median ${MiB(med(s.map((x) => x.pss)))} peak ${MiB(peakPss)} MiB; per daemon at peak RSS ${peak.per.map(MiB).join(", ")}; worktree daemon median ${MiB(med(s.map((x) => x.wt)))}; MemAvailable min ${MiB(Math.min(...s.map((x) => x.avail)))} MiB; max processes ${Math.max(...s.flatMap((x) => x.members))}`);
};
console.log("commit daemon pids", [...pids].join(" "));
phase("start (calls)", marks.calls, marks["calls-done"]);
const idleA = marks["calls-done"] + 5000, idleB = marks.groups;
phase("idle after calls (first 55 s)", idleA, Math.min(idleB, idleA + 55000));
phase("idle after calls (after 60 s)", idleA + 62000, idleB);
phase("groups", marks.groups, marks["groups-done"] + 2000);
phase("idle after groups", marks["groups-done"] + 3000, marks["groups-done"] + 15000);
