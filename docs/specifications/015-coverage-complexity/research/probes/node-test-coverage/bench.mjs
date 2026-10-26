// Throwaway (015-76): runs every file of sample.tsv (cwd, file, argv; cwd relative to <work>) the way
// Squeal's runner does (see run-file.mjs), `concurrency` processes at once, in one coverage mode:
//   off    no coverage
//   raw    NODE_V8_COVERAGE=<out>/<i>/cov
//   drop   raw, plus drop-env.cjs as the second --require (children write nothing)
//   event  --experimental-test-coverage (the test:coverage event in events.ndjson)
// usage: node bench.mjs <mode> <sample.tsv> <work> <out> [concurrency=4]
// Prints one JSON line: wall ms, per-file ms, failures, coverage bytes.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const [mode, list, work, outArg, conc = "4"] = process.argv.slice(2);
const out = resolve(outArg);
const repo = resolve(import.meta.dirname, "../../../../../..");
const runtime = join(repo, "src/runners/node-test/runtime");
const rows = readFileSync(list, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
rmSync(out, { recursive: true, force: true });
const base = { ...process.env };
delete base.NODE_V8_COVERAGE;
delete base.NODE_TEST_CONTEXT;
const one = (i) => new Promise((done) => {
  const [cwd, file, argvText] = rows[i];
  const dir = join(out, String(i));
  mkdirSync(dir, { recursive: true });
  const env = { ...base, SQUEAL_NODE_TEST_GRAPH: join(dir, "graph") };
  const pre = ["--enable-source-maps", "--require", join(runtime, "recorder.cjs")];
  if (mode === "drop") pre.push("--require", join(import.meta.dirname, "drop-env.cjs"));
  if (mode === "raw" || mode === "drop") env.NODE_V8_COVERAGE = join(dir, "cov");
  const args = [...pre, ...(argvText ? argvText.split(" ") : []), "--test",
    ...(mode === "event" ? ["--experimental-test-coverage"] : []),
    `--test-reporter=${join(runtime, "reporter.mjs")}`, `--test-reporter-destination=${join(dir, "events.ndjson")}`, file];
  const started = performance.now();
  const child = spawn(process.execPath, args, { cwd: join(work, cwd), env, stdio: "ignore" });
  child.on("exit", (code) => done({ i, file: `${cwd}/${file}`, code, ms: Math.round(performance.now() - started) }));
});
const started = performance.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Number(conc) }, async () => {
  while (next < rows.length) results.push(await one(next++));
}));
const wall = Math.round(performance.now() - started);
let bytes = 0;
for (let i = 0; i < rows.length; i++) {
  const dir = join(out, String(i), "cov");
  try { for (const n of readdirSync(dir)) bytes += statSync(join(dir, n)).size; } catch {}
}
results.sort((a, b) => a.i - b.i);
process.stdout.write(`${JSON.stringify({ mode, wall, files: rows.length, failed: results.filter((r) => r.code !== 0).map((r) => r.file), covBytes: bytes, ms: results.map((r) => r.ms) })}\n`);
