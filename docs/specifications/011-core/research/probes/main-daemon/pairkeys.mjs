// 011-157 probe (throwaway), questions 1 and 4: the keys the probe's main checkout and its linked worktree computed, compared file by file.
// Usage: node pairkeys.mjs <store copy of /tmp/md157/x/main/.git/squeal>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const ws = db.prepare("SELECT id, root, is_main FROM worktrees").all(); console.log(ws.map((w) => `${w.id} main=${w.is_main} ${w.root}`).join("\n"));
const keys = (w) => new Map(db.prepare("SELECT project || char(0) || path f, key, pending FROM test_file_keys WHERE worktree_id = ?").all(w).map((x) => [x.f, x]));
const m = ws.find((w) => w.is_main === 1), l = ws.find((w) => w.is_main === 0);
const a = keys(m.id), b = keys(l.id); let eq = 0, ne = 0, only = 0, nul = 0; const diff = [];
for (const [f, x] of a) { const y = b.get(f); if (!y) { only++; continue; } if (x.key === null || y.key === null) { nul++; continue; } if (x.key === y.key) eq++; else { ne++; diff.push(f.replace("\0", " :: ")); } }
console.log(`main files ${a.size}, linked files ${b.size}; equal keys ${eq}, different ${ne}, unkeyed in one ${nul}, main only ${only}, linked only ${[...b.keys()].filter((f) => !a.has(f)).length}`);
for (const f of diff.slice(0, 40)) console.log("  differs:", f);
const cl = new Map(db.prepare("SELECT project || char(0) || path f, closure_paths FROM test_files").all().map((t) => [t.f, JSON.parse(t.closure_paths)]));
const cnt = new Map(); for (const f of diff) for (const p of cl.get(f.replace(" :: ", "\0")) ?? []) cnt.set(p, (cnt.get(p) ?? 0) + 1);
console.log("closure paths most common among the differing files:", [...cnt].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([p, n]) => `${p} ${n}`).join(", "));
