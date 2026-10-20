// Throwaway probe (011-35): golden keys and stored rows over canned inputs.
//   node --experimental-transform-types --import ./register.mjs golden.mjs <checkout>
// Prints one JSON line per fixture: the environment hash, a check key, and the
// rows recordsForFile stores for canned run reports. Run it over checkouts of
// several releases (key-format.ts patched to one value, see golden.sh) and diff.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const load = (path) => import(pathToFileURL(join(root, path)).href);
const keys = await load("src/core/keys/index.ts");
const { recordsForFile } = await load("src/core/scheduler/records.ts");
const { describeFailure } = await load("src/core/state/fingerprint.ts");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const hashOf = (path) => (path.endsWith("missing.ts") ? null : sha(`content of ${path}`).slice(0, 40));
const out = {};

// Keys over fixed inputs.
const core = {
  squealVersion: "0.1.0",
  nodeVersion: "v24.21.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps-fingerprint",
  env: { CI: "1", NODE_ENV: "test" },
};
const runner = {
  project: "app",
  runnerName: "vitest",
  runnerVersion: "3.2.4",
  adapterVersion: "3",
  resolvedConfig: '{"root":"."}',
  files: ["vitest.config.ts", "test/setup.ts"],
};
const env = keys.environmentHash(core, runner, hashOf);
out.environmentHash = env;
const testFile = { project: "app", path: "test/a.test.ts" };
const closure = { testFile, paths: ["src/a.ts", "src/b.ts", "src/missing.ts", "test/a.test.ts"] };
out.checkKey = keys.checkKey(env, closure, hashOf);
out.checkKeyWithDeps = keys.checkKey(env, closure, hashOf, "pkg@1.0.0");

// Stored rows for canned reports.
const ref = testFile;
const test = (name) => ({ kind: "test", project: "app", testPath: ref.path, fullName: name });
const error = (message) => ({ name: "Error", message, stack: `Error: ${message}\n    at test/a.test.ts:3:9`, location: { path: "test/a.test.ts", line: 3, column: 9 }, diff: null });
const provenance = { worktreeId: "w1", revision: 1, commitSha: null, dirty: false, runId: "r1", recordedAt: 1000 };
const base = { end: "completed", durationMs: 50, completedFiles: [ref], results: [], fileErrors: [], failure: null };
const records = (report, previousChecks = []) =>
  recordsForFile({ ref, key: "K", report: { ...base, ...report }, previousChecks, provenance, describe: describeFailure });
const pass = (name) => ({ check: test(name), outcome: "pass", durationMs: 5, location: null, errors: [] });
const fail = (name) => ({ check: test(name), outcome: "fail", durationMs: 5, location: { path: ref.path, line: 3, column: 9 }, errors: [error("boom")] });

out.plain = records({ results: [pass("adds"), fail("subtracts")] });
out.loadError = records({ fileErrors: [{ testFile: ref, errors: [error("cannot import")] }] }, [test("adds"), test("subtracts")]);
out.errorAfterTests = records({ results: [pass("adds")], fileErrors: [{ testFile: ref, errors: [error("afterAll threw")] }] }, [test("adds")]);
out.moduleSkip = records({ results: [], skippedFiles: [{ testFile: ref }] }, [test("adds"), test("subtracts")]);

for (const [name, value] of Object.entries(out)) console.log(`${name}\t${sha(JSON.stringify(value)).slice(0, 12)}\t${JSON.stringify(value).slice(0, 160)}`);
