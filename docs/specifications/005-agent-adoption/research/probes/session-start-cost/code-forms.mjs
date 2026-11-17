// Throwaway. On a code store COPY: the uncounted-files read with a key-only index forced
// (INDEXED BY), and the failing-states read with a plain outcome predicate and an index.
// Indexes dropped after. Usage: node code-forms.mjs <common-dir> <worktree-id> <reps>
import { DatabaseSync } from "node:sqlite";
const [common, wt, reps] = process.argv.slice(2);
if (!common.includes("/t/38faef1c/")) throw new Error("copies only");
const code = new DatabaseSync(`${common}/squeal/code.sqlite`);
const time = (fn) => { const xs = []; for (let i = 0; i < Number(reps); i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); } xs.sort((a, b) => a - b); return `median ${xs[xs.length >> 1].toFixed(1)} p90 ${xs[Math.floor(xs.length * 0.9)].toFixed(1)} ms`; };
const q = (idx) => `SELECT * FROM files f WHERE f.worktree_id = ? AND f.too_big = 0 AND NOT EXISTS (SELECT 1 FROM counts c ${idx} WHERE c.blob = f.blob AND c.language = f.language AND c.counter_version = f.counter_version) ORDER BY f.path`;
const avg = code.prepare("SELECT AVG(LENGTH(functions)) a, COUNT(*) n FROM counts").get();
console.log(`counts: ${avg.n} rows, functions JSON ${Math.round(avg.a)} bytes on average`);
console.log("uncounted, as now:", time(() => code.prepare(q("")).all(wt)));
code.exec("CREATE INDEX probe_counts_key ON counts (blob, language, counter_version)");
console.log("uncounted, key-only index forced:", time(() => code.prepare(q("INDEXED BY probe_counts_key")).all(wt)));
code.exec("DROP INDEX probe_counts_key");
const f = (o) => `SELECT s.*, c.path, c.qualified_name, c.occurrence FROM states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND ${o} ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`;
console.log("failing, as now:", time(() => code.prepare(f("(? IS NULL OR s.outcome = ?)")).all(wt, "fail", "fail")));
code.exec("CREATE INDEX probe_states_outcome ON states (worktree_id, outcome)");
console.log("failing, plain predicate + index:", time(() => code.prepare(f("s.outcome = ?")).all(wt, "fail")));
code.exec("DROP INDEX probe_states_outcome");
