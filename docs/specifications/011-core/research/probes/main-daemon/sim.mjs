// 011-157 probe (throwaway), question 2: what a main daemon that stays up would run for the main checkout's moves, at <rate> recorded s per wall minute,
// when a later move supersedes a queued file it re-keys again (the queue holds one entry per file; a running file finishes).
// Usage: node sim.mjs <moves.jsonl with lists> <rate> [skip-stored]   skip-stored: a file some worktree already stored at equal content is not run.
import { readFileSync } from "node:fs";
const [, , movesPath, rateArg, skip] = process.argv; const rate = Number(rateArg) / 60000;
const moves = readFileSync(movesPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.list).sort((a, b) => a.at - b.at);
const queue = new Map(); let t = moves[0]?.at ?? 0, ran = 0, superseded = 0, skipped = 0;
const drain = (until) => { for (const [f, sec] of queue) { const need = sec / rate; if (t + need > until) break; t += need; ran += sec; queue.delete(f); } if (t < until && queue.size === 0) t = until; };
for (const m of moves) {
  drain(m.at); if (t < m.at) t = m.at;
  for (const [f, sec, stored] of m.list) { if (skip && stored) { skipped += sec; if (queue.has(f)) { superseded += queue.get(f); queue.delete(f); } continue; } if (queue.has(f)) { superseded += queue.get(f); queue.delete(f); } queue.set(f, sec); }
}
drain(Infinity);
console.log(`rate ${rateArg} s/min${skip ? ", stored skipped" : ""}: ran ${Math.round(ran)} recorded s over ${moves.length} moves; superseded before running ${Math.round(superseded)} s; skipped as stored ${Math.round(skipped)} s`);
