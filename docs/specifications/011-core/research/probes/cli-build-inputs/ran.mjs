// Throwaway probe for 011-127: which test files the scratch daemon ran since <ms>, their summed
// file durations, and how many of them are in <gap.json>'s build list. usage: node ran.mjs <ms> [gap.json]
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const since = Number(process.argv[2]);
const builders = process.argv[3] ? new Set(JSON.parse(readFileSync(process.argv[3], "utf8")).map((r) => r.test)) : new Set();
const db = new DatabaseSync("/tmp/r127/repo/.git/squeal/store.sqlite", { readOnly: true });
const rows = db.prepare(`SELECT c.test_path AS path, r.duration_ms AS ms, r.outcome AS outcome FROM results r JOIN checks c ON c.id = r.check_id
  WHERE c.kind = 'file' AND r.recorded_at >= ? ORDER BY r.duration_ms DESC`).all(since);
const runs = db.prepare("SELECT revision, started_at, ended_at, end_state FROM runs WHERE started_at >= ? ORDER BY started_at").all(since);
const sum = (rs) => rs.reduce((s, r) => s + r.ms, 0) / 1000;
const b = rows.filter((r) => builders.has(r.path));
console.log(JSON.stringify({
  files: rows.length, summedS: +sum(rows).toFixed(1), failed: rows.filter((r) => r.outcome !== "pass").map((r) => r.path),
  builderFiles: b.length, builderSummedS: +sum(b).toFixed(1),
  otherFiles: rows.length - b.length, otherSummedS: +(sum(rows) - sum(b)).toFixed(1),
  tiers: runs.length, firstStart: runs[0]?.started_at, lastEnd: Math.max(...runs.map((r) => r.ended_at ?? 0)),
  tierWallS: runs.length ? +((Math.max(...runs.map((r) => r.ended_at ?? 0)) - runs[0].started_at) / 1000).toFixed(1) : 0,
  top: rows.slice(0, 8).map((r) => `${r.path} ${(r.ms / 1000).toFixed(1)}`),
  others: rows.filter((r) => !builders.has(r.path)).map((r) => r.path),
}, null, 1));
