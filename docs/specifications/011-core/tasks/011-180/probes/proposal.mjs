// Row 011-180: the proposed rule on yield.mjs's and match.mjs's lines. A tier that has run at least `floor` s does not
// yield to a promoted file while it runs a file the same or an earlier live wait selected (match.mjs's cutNamed); a
// revision during the run (an edit's work) still makes it yield, so such a yield counts as unsure.
// Usage: node proposal.mjs <yield-*.jsonl> <match-*.jsonl> [floor s, default 30]
import { readFileSync } from "node:fs";
const [, , yields, matches, floorArg = "30"] = process.argv;
const floor = Number(floorArg);
const lines = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => !o.summary);
const match = new Map(lines(matches).map((m) => [m.run, m]));
const r1 = (x) => +x.toFixed(1);
const out = { floor, refused: 0, unsure: 0, cut: 0, lowS: 0, highS: 0, promotedWaitsS: [], kept: [] };
for (const o of lines(yields)) {
  const m = match.get(o.run);
  if (!m || m.cutNamed === 0 || o.wall < floor) continue;
  const rev = o.scope === "live" ? o.during.length > 0 : !!(o.next && o.next.revision > o.revision);
  if (rev) out.unsure++; else out.refused++;
  out.cut += o.grace + o.inFlight; out.lowS += o.secs.low; out.highS += o.secs.high;
  // The promoted file then waits the tier's remainder: the cut files' remainder past the end, at least 0.
  const left = Math.max(0, ...o.cutFiles.map((f) => f.leftS ?? 0));
  out.promotedWaitsS.push(r1(left));
  out.kept.push({ run: o.run, worktree: o.worktree, wall: o.wall, cut: o.grace + o.inFlight, named: m.cutNamed, lowS: o.secs.low, highS: o.secs.high, promotedWaitsS: r1(left), unsure: rev });
}
const s = [...out.promotedWaitsS].sort((a, b) => a - b);
console.log(JSON.stringify({ ...out, lowS: r1(out.lowS), highS: r1(out.highS),
  promotedWaitTotalS: r1(s.reduce((a, b) => a + b, 0)), promotedWaitMedianS: s.length ? r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }, null, 1));
