import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";
import { DEFAULT_POLICY, type NodeTestProject } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, type Harness, openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 001-307 (spec 005 D3, open question 6; 001 D4 as amended): a
 * `run --all` with `observeIgnored`, setup's warm-up, stores per test file
 * the gitignored worktree paths it read, capped at 50 with a count of the
 * rest. A slow Vitest file and a slow node:test file read the gitignored
 * `ignored/build.txt`. Keys, closures and results are those of a run
 * without the flag; a run without it stores nothing. The Vitest file's
 * closure keys the ignored file (spec 016 D4, the written-directory bound),
 * so the warm-up reports it for the node:test file only, and a change of
 * it re-runs the Vitest file only.
 */
export const VITEST = "test/runtime.test.ts";
export const READS = "nt/reads.test.mjs";
export const MANY = "nt/many.test.mjs";
/** Reads nothing ignored: observed, its entry is empty. */
export const QUIET = "nt/quiet.test.mjs";
export const BUILD = "ignored/build.txt";
const NODE_TEST: NodeTestProject = {
  name: "nt",
  node: process.execPath,
  // A project preload: the warm-up's recorder must not move its loads into the test file's closure.
  argv: ["--require", "./nt/setup.cjs"],
  env: {},
  include: ["nt/*.test.mjs"],
  slow: true,
};

const READS_TEST = `import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { label } from "./lib.mjs";

test("reads the gitignored build output", () => {
  const text = readFileSync(new URL("../${BUILD}", import.meta.url), "utf8");
  assert.equal(label(text), "built");
});
`;
const MANY_TEST = `import { test } from "node:test";
import { readFileSync } from "node:fs";

test("reads sixty gitignored files", () => {
  for (let i = 0; i < 60; i++) readFileSync(new URL(\`../ignored/many/\${String(i).padStart(2, "0")}.txt\`, import.meta.url));
});
`;

const QUIET_TEST = `import { test } from "node:test";
import { label } from "./lib.mjs";

test("reads nothing ignored", () => {
  if (label("quiet here") !== "quiet") throw new Error("label");
});
`;

/**
 * The repository and its harness; `started`, its baseline run and idle.
 * `runtimeInputs` is policy `observe.runtimeInputs`: off, Vitest observes nothing.
 */
export async function warmUpRepo({ started = true, runtimeInputs = true } = {}): Promise<{
  h: Harness;
  commonDir: string;
}> {
  const repo = createRepo("observed");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), text);
  };
  write("nt/lib.mjs", `export const label = (text) => text.trim().split(/\\s/)[0];\n`);
  write("nt/setup.cjs", `require("./preloaded.cjs");\n`);
  write("nt/preloaded.cjs", `globalThis.preloaded = true;\n`);
  write(READS, READS_TEST);
  write(MANY, MANY_TEST);
  write(QUIET, QUIET_TEST);
  for (let i = 0; i < 60; i++) write(`ignored/many/${String(i).padStart(2, "0")}.txt`, `${i}\n`);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "node:test files"]);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-307-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    nodeTest: [NODE_TEST],
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, include: [VITEST] },
      observe: { runtimeInputs },
    },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  });
  if (started) {
    await h.scheduler.start();
    await h.scheduler.idle();
  }
  return { h, commonDir: repo.commonDir };
}

/** Every test file's key and closure, and every check's result status. */
export function snapshot(h: Harness) {
  const files = h.store.testFileKeys
    .list(h.worktreeId)
    .map((row) => ({
      file: `${row.testFile.project}:${row.testFile.path}`,
      key: row.key,
      closure: h.store.testFiles.get(row.testFile)?.closure.paths ?? null,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const checks = h.store.knownStates
    .list(h.worktreeId)
    .map((s) => `${s.check.project}:${s.check.testPath}:${s.validity}:${s.outcome}`)
    .sort();
  return { files, checks };
}
