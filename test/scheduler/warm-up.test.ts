import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readIgnoredReads } from "../../src/core/status/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type NodeTestProject } from "../../src/core/types/index.js";
import { readRuns } from "../e2e/support.js";
import { git } from "../hash/git-repo.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-307 (spec 005 D3, open question 6; 001 D4 as amended): a
 * `run --all` with `observeIgnored`, setup's warm-up, stores per test file
 * the gitignored worktree paths it read, capped at 50 with a count of the
 * rest. A slow Vitest file and a slow node:test file read the gitignored
 * `ignored/build.txt`. Keys, closures and results are those of a run
 * without the flag; a run without it stores nothing; a change of the
 * ignored file re-runs nothing.
 */
const VITEST = "test/runtime.test.ts";
const READS = "nt/reads.test.mjs";
const MANY = "nt/many.test.mjs";
const BUILD = "ignored/build.txt";
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

async function warmUpRepo(): Promise<{ h: Harness; commonDir: string }> {
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
  for (let i = 0; i < 60; i++) write(`ignored/many/${String(i).padStart(2, "0")}.txt`, `${i}\n`);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "node:test files"]);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-307-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    nodeTest: [NODE_TEST],
    policy: { slow: { ...DEFAULT_POLICY.slow, include: [VITEST] } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  return { h, commonDir: repo.commonDir };
}

/** Every test file's key and closure, and every check's result status. */
function snapshot(h: Harness) {
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

async function fullSuite(h: Harness, observeIgnored: boolean) {
  const record = await h.scheduler.requestFullSuite({ force: true, observeIgnored });
  await h.scheduler.idle();
  return record;
}

describe("a warm-up reports the ignored paths each file read (task 001-307)", SLOW, () => {
  it("stores them only for a flagged checkpoint, with keys, closures and results as without it", async () => {
    const { h } = await warmUpRepo();
    const baseline = snapshot(h);
    expect(baseline.files.map((f) => f.file)).toEqual(
      expect.arrayContaining([`forks:${VITEST}`, `threads:${VITEST}`, `nt:${READS}`]),
    );
    expect(baseline.checks.every((c) => c.endsWith(":current:pass"))).toBe(true);
    // The node:test closure holds what the file loads, never what it read.
    const reads = baseline.files.find((f) => f.file === `nt:${READS}`);
    expect(reads?.closure).toEqual(expect.arrayContaining(["nt/lib.mjs", READS]));
    expect(reads?.closure).not.toContain(BUILD);
    expect(reads?.closure).not.toContain("nt/preloaded.cjs");

    await fullSuite(h, false);
    expect(readIgnoredReads(h.store, h.worktreeId)).toBeNull();
    expect(snapshot(h)).toEqual(baseline);

    const record = await fullSuite(h, true);
    expect(snapshot(h)).toEqual(baseline);
    const stored = readIgnoredReads(h.store, h.worktreeId);
    expect(stored?.checkpoint).toBe(record.id);
    expect(stored?.revision).toBe(record.revision);
    for (const id of [`forks\0${VITEST}`, `threads\0${VITEST}`, `nt\0${READS}`]) {
      expect(stored?.files[id], id).toEqual({ paths: [BUILD], more: 0 });
    }
    // Capped at 50, sorted, with the count of the rest.
    const many = stored?.files[`nt\0${MANY}`];
    expect(many?.paths).toHaveLength(50);
    expect(many?.paths[0]).toBe("ignored/many/00.txt");
    expect(many?.paths[49]).toBe("ignored/many/49.txt");
    expect(many?.more).toBe(10);
    // A file that read nothing ignored has no entry.
    expect(stored?.files["nt\0nt/lib.mjs"]).toBeUndefined();
    expect(Object.keys(stored?.files ?? {}).some((id) => id.endsWith("plain.test.ts"))).toBe(false);

    // A later checkpoint without the flag leaves the warm-up's record as it was.
    await fullSuite(h, false);
    expect(readIgnoredReads(h.store, h.worktreeId)).toEqual(stored);
  });

  it("re-runs nothing when an ignored path the warm-up reported changes", async () => {
    const { h, commonDir } = await warmUpRepo();
    await fullSuite(h, true);
    const before = snapshot(h);
    const runs = readRuns(storePaths(commonDir).database, h.worktreeId).length;
    h.write(BUILD, "built v2\n");
    await h.batch(BUILD);
    await h.scheduler.idle();
    expect(readRuns(storePaths(commonDir).database, h.worktreeId)).toHaveLength(runs);
    expect(snapshot(h)).toEqual(before);
    expect(h.header().counts.pending).toBe(0);
  });
});
