// 011-157 probe (throwaway), question 5: which first starts would lose the start verdict with linked worktrees lookup-only and a main daemon
// that runs the main checkout's moves at <rate> recorded s per wall minute. A start loses it when some file's content is not the main HEAD's
// (cause "content"), or when the daemon had not finished the moves before the start (cause "behind", the backlog bound of lag.mjs).
// Usage: node loss.mjs <cov.jsonl> <moves.jsonl> <rate>
import { readFileSync } from "node:fs";
const [, , covPath, movesPath, rateArg] = process.argv; const rate = Number(rateArg);
const read = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cov = read(covPath).filter((c) => c.n), moves = read(movesPath).filter((m) => !m.err).sort((a, b) => a.at - b.at);
let backlog = 0, last = null; const after = [];
for (const m of moves) { if (last) backlog = Math.max(0, backlog - rate * (m.at - last) / 60000); backlog += m.secs; after.push({ at: m.at, backlog }); last = m.at; }
const by = {}; let lose = 0, missLeft = 0, missAll = 0;
for (const c of cov) {
  const b = [...after].reverse().find((x) => x.at <= c.t); const left = b ? Math.max(0, b.backlog - rate * (c.t - b.at) / 60000) : 0;
  const cause = c.eqNow < c.n ? "content" : left > 0 ? "behind" : "none";
  by[c.where] ??= { starts: 0, content: 0, behind: 0, none: 0 }; by[c.where].starts++; by[c.where][cause]++; if (cause !== "none") lose++;
  missAll += c.mSecs ?? 0; missLeft += Math.max(0, (c.mSecs ?? 0) - (c.mEqSecs ?? 0)) + (cause === "behind" ? Math.min(left, c.mEqSecs ?? 0) : 0);
}
console.log(`rate ${rate}: ${cov.length} starts; lose the start verdict ${lose} (${(100 * lose / cov.length).toFixed(0)}%)`, JSON.stringify(by));
console.log(`  misses today ${Math.round(missAll)} s; of them still not run at the start with the main daemon ${Math.round(missLeft)} s (${(100 * missLeft / missAll).toFixed(1)}%)`);
