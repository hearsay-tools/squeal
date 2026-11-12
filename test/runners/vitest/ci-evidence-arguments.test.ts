import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readEvidence } from "../../../src/core/ci/inputs.js";
import { takeRecorded } from "../../../src/runners/observe/read.js";
import { blob, fill, run, temp } from "./ci-evidence-kit.js";

/*
 * Spec 018 D9, row 018-43 (`research/left-out-files.md`, cause A). The
 * daemon's recorder reads each existing file a spawn names in its arguments
 * (`observe/spawn.cjs`, `recordArguments`), so the test's key holds it even
 * when the child never opens it: squawk's `pi-*.mjs` extension scripts given
 * to a mock `pi`, its `sgconfig.yml` given to the native `sg`. The run takes
 * evidence of the same paths at the spawn, by the same rule: no directory,
 * no missing path, no option, a path relative to the spawn's `cwd`, and
 * `execSync`'s shell command not at all. It adds nothing to what the
 * daemon's recorder observes.
 */

/** A program that never opens its arguments. */
const MOCK = "process.exitCode = 0;\n";

const SCRIPT = `import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
const node = process.execPath;
execFileSync(node, ["mock.cjs", "--extension", "ext/pi-a.mjs"]);
spawnSync(node, ["mock.cjs", "--extension", "./ext/pi-b.mjs", "dir", "missing.mjs", "--x=ext/flag.mjs"]);
await once(spawn(node, ["../mock.cjs", "--extension", "../ext/pi-c.mjs"], { cwd: "sub" }), "exit");
execFileSync("sh", ["-c", "exit 0", "--config", "sgconfig.yml"]);
execSync("true ext/shell.mjs");
`;

const FILES = {
  "mock.cjs": MOCK,
  "ext/pi-a.mjs": "a",
  "ext/pi-b.mjs": "b",
  "ext/pi-c.mjs": "c",
  "ext/flag.mjs": "flag",
  "ext/shell.mjs": "shell",
  "sgconfig.yml": "rules",
  "dir/x.txt": "x",
  "sub/.keep": "",
  "script.mjs": SCRIPT,
};

/** `SCRIPT` in `root`, filled again; the evidence and the recorder's observed paths as `out` asks. */
function runScript(out: { evidence?: boolean; observed?: boolean }, root = join(temp(), "root")) {
  fill(root, FILES);
  const evidence = out.evidence ? temp() : undefined;
  const observed = out.observed ? temp() : undefined;
  run(root, {
    ...(evidence === undefined ? {} : { evidence }),
    ...(observed === undefined ? {} : { observed }),
  });
  const reads = [...(observed === undefined ? [] : takeRecorded(observed).values())];
  return {
    evidence: evidence === undefined ? {} : readEvidence(evidence),
    observed: reads.flatMap((r) => [...r.paths].map((p) => relative(root, p))).sort(),
  };
}

describe("a spawn's file arguments, as the daemon's recorder keys them (018-43, cause A)", () => {
  it("takes evidence of each existing file a spawn names, whether or not the child reads it", () => {
    expect(runScript({ evidence: true }).evidence).toEqual({
      "ext/pi-a.mjs": blob("a"),
      "ext/pi-b.mjs": blob("b"),
      "ext/pi-c.mjs": blob("c"),
      "mock.cjs": blob(MOCK),
      "script.mjs": blob(SCRIPT),
      "sgconfig.yml": blob("rules"),
    });
  });

  it("has evidence of every path the daemon's recorder observes, and adds none to them", () => {
    const root = join(temp(), "root");
    const alone = runScript({ observed: true }, root).observed;
    const beside = runScript({ observed: true, evidence: true }, root);
    expect(beside.observed).toEqual(alone);
    expect(alone).toEqual(expect.arrayContaining(["ext/pi-a.mjs", "sgconfig.yml"]));
    expect(Object.keys(beside.evidence).sort()).toEqual(alone);
  });
});
