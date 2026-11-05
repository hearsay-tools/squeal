// 011-298 probe (throwaway): what restart baselines found: file runs with a stored FAIL, by miss cause.
// Usage: node verdicts.cjs <store copy> <classify output.jsonl> <causes per file: optional>
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const L = fs.readFileSync(process.argv[3], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const runsOf = db.prepare("select id from runs where checkpoint_id = ?");
const fails = db.prepare("select c.project, c.test_path from results r join checks c on c.id = r.check_id where r.run_id = ? and r.outcome = 'fail'");
const trans = db.prepare("select count(*) n from transitions t join checks c on c.id = t.check_id where t.worktree_id = ? and c.project = ? and c.test_path = ? and t.at >= ? and t.to_outcome = 'fail'");
const failed = new Set(); const byCk = new Map();
for (const x of L) if (!byCk.has(x.ck)) byCk.set(x.ck, x);
for (const [ck, x] of byCk) for (const r of runsOf.all(ck)) for (const f of fails.all(r.id)) failed.add(ck + "\0" + f.project + "\0" + f.test_path);
let files = 0, sec = 0, failFiles = 0, failSec = 0, cezarWorktrees = new Set();
for (const x of L) { if (!x.ran) continue; files++; sec += x.sec; if (failed.has(x.ck + "\0" + x.file)) { failFiles++; failSec += x.sec; cezarWorktrees.add(x.W); } }
console.log(`restart-baseline file runs ${files} (${Math.round(sec)} s); with a stored FAIL ${failFiles} (${Math.round(failSec)} s) in ${cezarWorktrees.size} worktrees`);
