// Throwaway probe for 011-127: the share of an option-A edit run that option A adds, which is the gap files whose
// current key lacks the edited file, with their measured durations in that run. usage: node extra.mjs <gap-full.json> <edited> <from-ms> <to-ms>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [gapPath, edited, from, to] = process.argv.slice(2);
const missed = new Set(JSON.parse(readFileSync(gapPath, "utf8")).filter((r) => r.missingList.includes(edited)).map((r) => r.test));
const db = new DatabaseSync("/tmp/r127/repo/.git/squeal/store.sqlite", { readOnly: true });
const rows = db.prepare(`SELECT c.test_path AS path, r.duration_ms AS ms FROM results r JOIN checks c ON c.id = r.check_id
  WHERE c.kind = 'file' AND r.recorded_at BETWEEN ? AND ?`).all(Number(from), Number(to) + 5000);
const added = rows.filter((r) => missed.has(r.path));
console.log(JSON.stringify({ edited, missedBy: missed.size, ran: added.length, addedSummedS: +(added.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1),
  ranTotal: rows.length, totalSummedS: +(rows.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1) }));
