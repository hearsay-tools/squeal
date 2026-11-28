// Throwaway probe: exercise evidence output with no application writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const recorder = process.argv[2];
if (!recorder) throw new Error('Pass an absolute evidence.cjs path');
const load = os.loadavg()[0];
const cpus = os.cpus().length;
if (load > cpus) {
  console.log(JSON.stringify({ skipped: true, load, cpus }));
  process.exit(0);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squeal-issue-311-'));
const out = path.join(root, 'evidence');
fs.mkdirSync(out);
fs.writeFileSync(path.join(root, 'input.txt'), 'input\n');
const { createEvidence } = require(recorder);
const evidence = createEvidence({ root, out, skip: [], format: 'sha1' });
const original = fs.writeFileSync;
const calls = [];
fs.writeFileSync = function (...args) {
  calls.push({ path: args[0], payload: String(args[1]), options: args[2] });
  return original.apply(this, args);
};
syncBuiltinESMExports();
try {
  // Simulates a recorder callback during a test that makes no writes.
  evidence.read(path.join(root, 'input.txt'));
  evidence.flush();
} finally {
  fs.writeFileSync = original;
  syncBuiltinESMExports();
}
console.log(JSON.stringify({ node: process.version, load, cpus, recorder, applicationWrites: 0, spyCalls: calls.length, calls }, null, 2));
fs.rmSync(root, { recursive: true, force: true });
if (calls.length === 0) process.exitCode = 1;
