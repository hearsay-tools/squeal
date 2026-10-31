// Throwaway probe (018-03). Size of the closure data a fresh clone would need
// to compute keys without the runner: test_files closure lists plus the
// shared observed-input maps in meta. From a COPIED store, read-only.
// Usage: node closure-size.mjs <copy/store.sqlite>
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tf = db.prepare("SELECT project, path, closure_paths, complete, method FROM test_files").all();
const meta = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed%'").all();
const projects = db.prepare("SELECT project, COUNT(*) n, AVG(json_array_length(closure_paths)) avg FROM test_files GROUP BY project").all();
const sz = (v) => ({ bytes: Buffer.byteLength(JSON.stringify(v)), gzip: gzipSync(JSON.stringify(v)).length });
console.log(JSON.stringify({ projects, testFiles: { rows: tf.length, ...sz(tf) }, observedMeta: { keys: meta.map((m) => m.key), ...sz(meta) } }, null, 1));
