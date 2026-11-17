// Throwaway. On store COPIES only: times the registration's heaviest reads and writes as they are,
// and the cheaper forms questions 2 and 3 ask about. Each write runs in a transaction that is
// rolled back; each index is dropped after. Usage: node read-less.mjs <common-dir> <worktree-id> <reps>
import { DatabaseSync } from "node:sqlite";
const [common, wt, reps] = process.argv.slice(2);
if (!common.includes("/t/38faef1c/")) throw new Error("copies only");
const store = new DatabaseSync(`${common}/squeal/store.sqlite`);
const code = new DatabaseSync(`${common}/squeal/code.sqlite`);
const time = (fn) => { const xs = []; for (let i = 0; i < Number(reps); i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); } xs.sort((a, b) => a - b); return `median ${xs[xs.length >> 1].toFixed(1)} p90 ${xs[Math.floor(xs.length * 0.9)].toFixed(1)} ms`; };
const n = Number(Object.values(store.prepare("SELECT COUNT(*) FROM known_states WHERE worktree_id=?").get(wt))[0]);
console.log(`worktree ${wt}: ${n} known states`);
// Q3a: the view write as it is (per state: insert-or-ignore the check, select its id, write the view)
const states = store.prepare(`SELECT s.*, c.project, c.test_path, c.kind, c.full_name FROM known_states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`);
console.log("read states + join checks (as the registration):", time(() => states.all(wt)));
const ins = store.prepare("INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING");
const sel = store.prepare("SELECT id FROM checks WHERE project = ? AND test_path = ? AND kind = ? AND full_name = ?");
const view = store.prepare("INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const rows = states.all(wt);
console.log("view write as now, 3 statements per state:", time(() => { store.exec("BEGIN IMMEDIATE"); for (const r of rows) { ins.run(r.project, r.test_path, r.kind, r.full_name, 1); const id = sel.get(r.project, r.test_path, r.kind, r.full_name).id; view.run(wt, "probe", "main", id, r.outcome, r.fingerprint, 1); } store.exec("ROLLBACK"); }));
console.log("view write with the state's check_id, 1 statement per state:", time(() => { store.exec("BEGIN IMMEDIATE"); for (const r of rows) view.run(wt, "probe", "main", r.check_id, r.outcome, r.fingerprint, 1); store.exec("ROLLBACK"); }));
const bulk = store.prepare("INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at) SELECT worktree_id, 'probe', 'main', check_id, outcome, fingerprint, 1 FROM known_states WHERE worktree_id = ?");
console.log("view write as one INSERT ... SELECT:", time(() => { store.exec("BEGIN IMMEDIATE"); bulk.run(wt); store.exec("ROLLBACK"); }));
// Q2: code store, the uncounted-files read and the failing-states read
const unc = code.prepare(`SELECT * FROM files f WHERE f.worktree_id = ? AND f.too_big = 0 AND NOT EXISTS (SELECT 1 FROM counts c WHERE c.blob = f.blob AND c.language = f.language AND c.counter_version = f.counter_version) ORDER BY f.path`);
const failing = code.prepare(`SELECT s.*, c.path, c.qualified_name, c.occurrence FROM states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND (? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?) ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`);
const cs = Number(Object.values(code.prepare("SELECT COUNT(*) FROM states WHERE worktree_id=?").get(wt))[0]);
const plan = (st, ...a) => code.prepare(`EXPLAIN QUERY PLAN ${st}`).all(...a).map((r) => r.detail).join(" | ");
console.log(`code: ${cs} code states of the worktree`);
console.log("uncounted files, as now:", time(() => unc.all(wt)));
console.log("failing code states (outcome 'fail'), as now:", time(() => failing.all(wt, null, null, "fail", "fail")));
code.exec("CREATE INDEX probe_counts_key ON counts (blob, language, counter_version)");
console.log("uncounted files, with a key-only index on counts:", time(() => unc.all(wt)), plan(unc.sourceSQL, wt));
code.exec("DROP INDEX probe_counts_key");
code.exec("CREATE INDEX probe_states_outcome ON states (worktree_id, outcome)");
console.log("failing code states, with an index on (worktree_id, outcome):", time(() => failing.all(wt, null, null, "fail", "fail")), plan(failing.sourceSQL, wt, null, null, "fail", "fail"));
code.exec("DROP INDEX probe_states_outcome");
