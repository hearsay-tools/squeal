// Throwaway (015-76): runs one node:test file the way Squeal's runner does (src/runners/node-test/run/run.ts):
//   node --enable-source-maps --require <recorder> <argv...> --test --test-reporter=<reporter>
//        --test-reporter-destination=<out>/events.ndjson <file>
// with SQUEAL_NODE_TEST_GRAPH=<out>/graph, from <cwd>.
// usage: node run-file.mjs <off|raw|event> <cwd> <file> <out> [argv...]
//   raw:   NODE_V8_COVERAGE=<out>/cov
//   event: adds --experimental-test-coverage (the test:coverage event lands in events.ndjson)
// NTC_NODE=<path> runs another Node.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
const [mode, cwd, file, outArg, ...argv] = process.argv.slice(2);
const out = resolve(outArg);
const repo = resolve(import.meta.dirname, "../../../../../..");
const runtime = join(repo, "src/runners/node-test/runtime");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const env = { ...process.env, SQUEAL_NODE_TEST_GRAPH: join(out, "graph") };
delete env.NODE_V8_COVERAGE;
delete env.NODE_TEST_CONTEXT;
const extra = [];
if (mode === "raw") env.NODE_V8_COVERAGE = join(out, "cov");
if (mode === "event") extra.push("--experimental-test-coverage");
const args = [
  "--enable-source-maps", "--require", join(runtime, "recorder.cjs"), ...argv, "--test", ...extra,
  `--test-reporter=${join(runtime, "reporter.mjs")}`, `--test-reporter-destination=${join(out, "events.ndjson")}`, file,
];
const started = performance.now();
const r = spawnSync(process.env.NTC_NODE ?? process.execPath, args, { cwd, env, encoding: "utf8" });
const ms = performance.now() - started;
process.stdout.write(`${JSON.stringify({ mode, file, code: r.status, signal: r.signal, ms: Math.round(ms), stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })}\n`);
