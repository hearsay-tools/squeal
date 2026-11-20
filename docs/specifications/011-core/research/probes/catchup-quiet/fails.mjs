// 011-416 probe (throwaway): new failures each large recorded catch-up found, and when.
// Usage: node fails.mjs <store copy> <bursts dump .jsonl>
// For each episode marked large: transitions to fail (from another outcome) in its worktree during it,
// and the seconds from the episode start to the first one. A shorter quiet moves each by 120 - Q' s.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, dumpPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const year = "2026-";
for (const e of readFileSync(dumpPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.large)) {
  const s = Date.parse(year + e.start + "Z"), end = s + e.wallS * 1000;
  const rows = db.prepare("SELECT at, from_outcome f FROM transitions WHERE worktree_id LIKE ? AND to_outcome = 'fail' AND at >= ? AND at <= ? ORDER BY at").all(e.w + "%", s, end).filter((r) => r.f !== "fail");
  console.log(JSON.stringify({ w: e.w, start: e.start, F: e.F, wallS: e.wallS, newFails: rows.length, firstFailS: rows.length ? Math.round((rows[0].at - s) / 1000) : null }));
}
