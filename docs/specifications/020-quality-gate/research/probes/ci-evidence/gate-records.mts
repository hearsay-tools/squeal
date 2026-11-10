// Throwaway probe for research/ci-evidence.md, Q2: the records the gate's own
// collector (`collectEvidence`, row 020-03) makes for the named test files,
// written one JSON file per test file, so `compare.mjs` can set them beside
// the records the probe hook mapped inside the project's own Vitest.
// Usage, from the scratch clone: tsx gate-records.mts <out dir> <test file>...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectEvidence } from "../../../../../../src/core/code/gate/collect.js";
import { createNodeTestAdapter } from "../../../../../../src/runners/node-test/adapter.js";
import { createVitestAdapter } from "../../../../../../src/runners/vitest/index.js";

const [out, ...tests] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: gate-records.mts <out> <test>...");
const changed = {
  ref: "HEAD",
  baseCommit: "",
  headCommit: "",
  dirty: false,
  paths: [],
  functions: [],
  counted: [],
  inErrors: [],
  uncounted: [],
};
const t0 = performance.now();
const evidence = await collectEvidence(process.cwd(), changed as never, {
  tests,
  budgetSeconds: 600,
  adapters: { vitest: createVitestAdapter as never, nodeTest: createNodeTestAdapter as never },
  note: (text) => console.error(`note: ${text}`),
});
mkdirSync(join(out, "records"), { recursive: true });
for (const file of evidence.testFiles) {
  if (file.record === null) {
    console.error(`no record: ${file.path}`);
    continue;
  }
  writeFileSync(join(out, "records", `${file.path.replaceAll("/", "__")}.json`), JSON.stringify(file.record));
}
console.log(JSON.stringify({ files: evidence.testFiles.length, ms: Math.round(performance.now() - t0) }));
