import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readEvidence } from "../../../src/core/ci/inputs.js";
import { takeRecorded } from "../../../src/runners/observe/read.js";
import { blob, fill, run, temp } from "./ci-evidence-kit.js";

/*
 * Spec 018 D9, row 018-23 (review `wave-5-0.1.421-r3.md` N1). A child
 * process or Worker the run starts with an environment of its own, one that
 * drops `NODE_OPTIONS` and the hook's settings, still takes evidence: the
 * hook and its settings ride in the env the caller passed, as the daemon's
 * recorder rides for itself. So the child's write of an input the parent
 * read cancels its evidence, content unchanged. A child whose env names
 * another recording's settings is that recording's.
 */

const GOOD = "GOOD";

/** Writes `GOOD` to the file its last argument names, as a child the run starts. */
const WRITER = `const { argv } = process;
const { workerData } = require("node:worker_threads");
require("node:fs").writeFileSync(workerData ?? argv[argv.length - 1], "GOOD");
`;

const SCRIPT = `import { execFileSync, execSync, fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
const NAMES = ["execFileSync", "spawnSync", "execSync", "spawn", "fork", "worker", "options", "foreign"];
for (const name of NAMES) readFileSync(\`\${name}.txt\`);
readFileSync("kept.txt");
const node = process.execPath;
execFileSync(node, ["writer.cjs", "execFileSync.txt"], { env: {} });
spawnSync(node, ["writer.cjs", "spawnSync.txt"], { env: {} });
execSync(\`"\${node}" writer.cjs execSync.txt\`, { env: {} });
await once(spawn(node, ["writer.cjs", "spawn.txt"], { env: {} }), "exit");
await once(fork("writer.cjs", ["fork.txt"], { env: {} }), "exit");
await once(new Worker(new URL("./writer.cjs", import.meta.url), { env: {}, workerData: "worker.txt" }), "exit");
execFileSync(node, ["writer.cjs", "options.txt"], { env: { NODE_OPTIONS: "--no-warnings" } });
execFileSync(node, ["writer.cjs", "foreign.txt"], { env: { SQUEAL_CI_RECORD: "{}" } });
`;

const NAMES = ["execFileSync", "spawnSync", "execSync", "spawn", "fork", "worker", "options"];

/** `SCRIPT` in `root`, filled again; the evidence and the recorder's observations as `out` asks. */
function runScript(out: { evidence?: boolean; observed?: boolean }, root = join(temp(), "root")) {
  const files = Object.fromEntries([...NAMES, "foreign", "kept"].map((n) => [`${n}.txt`, GOOD]));
  fill(root, { ...files, "writer.cjs": WRITER, "script.mjs": SCRIPT });
  const evidence = out.evidence ? temp() : undefined;
  const observed = out.observed ? temp() : undefined;
  run(root, {
    ...(evidence === undefined ? {} : { evidence }),
    ...(observed === undefined ? {} : { observed }),
  });
  return {
    evidence: evidence === undefined ? {} : readEvidence(evidence),
    observed: observed === undefined ? [] : [...takeRecorded(observed)],
  };
}

describe("children and Workers with an environment of their own (018-23, review 0.1.421-r3 N1)", () => {
  it.each([
    ["alone", false],
    ["beside the daemon's recorder", true],
  ])("cancels what a child or Worker started with a replaced env writes, %s", (_how, observed) => {
    const { evidence } = runScript({ evidence: true, observed });
    expect(evidence).toEqual({
      "foreign.txt": blob(GOOD),
      "kept.txt": blob(GOOD),
      "script.mjs": blob(SCRIPT),
      "writer.cjs": blob(WRITER),
    });
  });

  it("leaves what the daemon's recorder observes as it is", () => {
    const root = join(temp(), "root");
    const alone = runScript({ observed: true }, root).observed;
    expect(alone.length).toBe(1);
    expect(runScript({ observed: true, evidence: true }, root).observed).toEqual(alone);
  });
});
