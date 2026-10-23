// 011-157 probe (throwaway), questions 1 and 5: had a main daemon that runs every re-keyed file at <rate> recorded s per wall minute finished
// the main checkout's moves before each linked worktree's first start? Backlog: each move adds its re-keyed seconds, minus what the rate drained
// since the move before (an upper bound: a later move that re-keys a file again supersedes it). Usage: node lag.mjs <cov.jsonl> <moves.jsonl> <rate>
import { readFileSync } from "node:fs";
const [, , covPath, movesPath, rateArg] = process.argv; const rate = Number(rateArg);
const read = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cov = read(covPath), moves = read(movesPath).filter((m) => !m.err).sort((a, b) => a.at - b.at);
let backlog = 0, last = null; const after = [];
for (const m of moves) { if (last) backlog = Math.max(0, backlog - rate * (m.at - last) / 60000); backlog += m.secs; after.push({ at: m.at, backlog, lastOnly: m.secs }); last = m.at; }
let starts = 0, behind = 0, behindLast = 0, sNow = 0, sOpen = 0, sOpenLast = 0;
for (const c of cov) {
  if (!c.n) continue; starts++; sNow += c.sNow;
  const b = [...after].reverse().find((x) => x.at <= c.t); if (!b) continue;
  const left = Math.max(0, b.backlog - rate * (c.t - b.at) / 60000), leftLast = Math.max(0, b.lastOnly - rate * (c.t - b.at) / 60000);
  if (left > 0) { behind++; sOpen += Math.min(left, c.sNow); }
  if (leftLast > 0) { behindLast++; sOpenLast += Math.min(leftLast, c.sNow); }
}
console.log(`rate ${rate} s/min: ${starts} starts; main daemon still behind at ${behind} (backlog bound) / ${behindLast} (last move only); seconds equal to main HEAD ${Math.round(sNow)}, of them not yet run ${Math.round(sOpen)} / ${Math.round(sOpenLast)}`);
