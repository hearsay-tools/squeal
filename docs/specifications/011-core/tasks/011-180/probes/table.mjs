// Row 011-180: the notes' per-yield table, one Markdown row per line of yield.mjs, with match.mjs's waits.
// Usage: node table.mjs <yield-*.jsonl> <match-*.jsonl>
import { readFileSync } from "node:fs";
const [, , yields, matches] = process.argv;
const lines = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => !o.summary);
const match = new Map(lines(matches).map((m) => [m.run, m]));
const f1 = (x) => (x === null || x === undefined ? "?" : (+x).toFixed(1));
// Rule B's branch on the probe's estimate; a cancel 30 to 32 s after the start is the overrun with no known duration.
const branch = (o) => (o.rule.branch !== "remainder" && o.wall >= 30 && o.wall < 32 ? "overrun at 30 s" : o.rule.branch);
console.log("| Run | Worktree | Files | Start (UTC) | Wall, s | Rule B (probe) | Waited for | Event before the end, s | Cut: grace + in flight | Cut s, low to high | Cut files' remainder past the end, s | Next tier after the end, s |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const o of lines(yields)) {
  const m = match.get(o.run);
  const rev = o.scope === "live" ? o.during.length > 0 : !!(o.next && o.next.revision > o.revision);
  const what = [rev ? (o.scope === "live" ? `r${o.during[0].n}` : "a revision") : null,
    m.waits > 0 ? (m.cutNamed > 0 ? `a wait that named ${m.cutNamed} cut file${m.cutNamed > 1 ? "s" : ""}` : m.nextNamed > 0 ? "a wait, named file next" : "a wait") : null]
    .filter(Boolean).join("; ") || "no revision, no wait found";
  const event = m.waits > 0 ? m.lastWaitBeforeEndS : o.scope === "live" && o.during.length ? o.wall - o.during[0].atS : null;
  const allStarted = o.neverStarted === 0 && o.picked <= 23;
  const left = !o.cutFiles.length ? "none cut" : !allStarted ? "not all started"
    : o.cutFiles.some((f) => f.leftS === null) ? "no later run" : f1(Math.max(...o.cutFiles.map((f) => f.leftS)));
  console.log(`| ${o.run} | ${o.worktree} (${o.scope}) | ${o.picked}${o.checkpoint ? ", checkpoint" : ""} | ${o.start.slice(5, 19).replace("T", " ")} | ${f1(o.wall)} | ${branch(o)} | ${what} | ${event === null ? "" : f1(event)} | ${o.grace} + ${o.inFlight} | ${f1(o.secs.low)} to ${f1(o.secs.high)} | ${left} | ${o.next ? f1(o.next.afterEndS) : "none"} |`);
}
