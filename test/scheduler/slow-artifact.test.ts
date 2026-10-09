import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { readSlowArtifacts } from "../../src/core/slow/state.js";
import { slowTierText } from "../../src/core/state/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D5, D8, review wave 2 B2: a slow run records the artifact its
 * file was declared to test under the key its results are stored at, in the
 * transaction that stores them; a fast run's results carry no record. In
 * the `basic` fixture `test/strings.test.ts` is marked slow.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";
const UPPER = "test/upper.test.ts";
const FAILING_UPPER = `import { expect, it } from "vitest";
import { upper } from "../src/strings.ts";

it("uppercases words", () => {
  expect(upper("ab")).toBe("ab");
});
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a slow run's recorded artifact (review wave 2, B2)", SLOW, () => {
  it("is the declaration the run had, under its key, and no fast run's", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-23-slot-"));
    dirs.push(slotDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] },
        inputs: { "test/strings.test.ts": ["src/gen/**"] },
      },
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    const key = h.keyOf(STRINGS);
    expect(key).not.toBeNull();
    const records = readSlowArtifacts(store, h.worktreeId);
    expect(records.get(key ?? "")).toEqual(["src/gen/**"]);
    expect(records.has(h.keyOf(MATH) ?? "")).toBe(false);
    expect([...records.keys()]).toEqual([key]);
  });
});

describe("a parallel slow tier records each file's own artifact (review wave 4, B1)", SLOW, () => {
  it("stores each file's declaration under its keys and names it in its failure and the line", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-37-slot-"));
    dirs.push(slotDir);
    const slow = { include: [STRINGS, UPPER], maxParallel: 2 };
    const inputs = { [STRINGS]: ["src/gen/**"], [UPPER]: ["src/strings.ts"] };
    const policy = { slow: { ...DEFAULT_POLICY.slow, ...slow }, inputs };
    // The delivered line and header read the policy on disk, as hooks do.
    writeFileSync(join(repo.main, "squeal.config.json"), `${JSON.stringify({ slow, inputs })}\n`);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy,
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    h.write(UPPER, FAILING_UPPER);
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    await delivery.onToolBoundary(consumer);
    await delivery.endTurn(consumer);
    await expect.poll(() => h.runsOf(UPPER).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    // One tier of both files, so one record per file is the tier's, not the first file's.
    expect(h.runsOf(STRINGS)).toEqual(h.runsOf(UPPER));
    const records = readSlowArtifacts(store, h.worktreeId);
    expect(records.get(h.keyOf(STRINGS) ?? "")).toEqual(["src/gen/**"]);
    expect(records.get(h.keyOf(UPPER) ?? "")).toEqual(["src/strings.ts"]);

    // The next prompt delivers the slow tier's failure.
    const delta = await delivery.startTurn(consumer);
    const lines = delta === null ? [] : formatDelta(delta).split("\n");
    const failure = lines.findIndex((line) => line.includes("uppercases words"));
    expect(lines[failure + 1]).toContain("against src/strings.ts as of revision");
    expect(lines[failure + 1]).not.toContain("src/gen/**");
    // The harness registers no worktree row; the line finds the policy through it.
    const worktree = { root: h.root, commonDir: repo.commonDir, isMain: true, daemon: null };
    store.worktrees.upsert({ id: h.worktreeId, registeredAt: 1, ...worktree });
    expect(slowTierText(h.header(), "squeal")).toContain(
      "2 current against src/gen/**, src/strings.ts as of revision",
    );
  });
});

describe("a parallel slow tier whose run re-keys a file (review wave 4, B1)", SLOW, () => {
  it("records the run key and the observed key of each file with that file's declaration", async () => {
    const repo = createRepo("observed");
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-37-slot-"));
    dirs.push(slotDir);
    const runtime = "test/runtime.test.ts";
    const plain = "test/plain.test.ts";
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      tierSize: 4,
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: [runtime, plain], maxParallel: 4 },
        inputs: { [runtime]: ["ignored/**"], [plain]: ["src/gen/**"] },
      },
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    // One tier of the four files: two paths under the forks and threads projects.
    expect(h.runner.runs.filter((run) => run.files.length === 4)).toHaveLength(1);
    const globs = (path: string) => (path === runtime ? ["ignored/**"] : ["src/gen/**"]);
    const current = store.testFileKeys.list(h.worktreeId);
    const records = readSlowArtifacts(store, h.worktreeId);
    for (const { testFile, key } of current)
      expect(records.get(key ?? "")).toEqual(globs(testFile.path));
    // What the runtime file read re-keyed it: its run keys are recorded with its declaration too.
    const currentKeys = new Set(current.map(({ key }) => key));
    const runKeys = [...records].filter(([key]) => !currentKeys.has(key));
    expect(runKeys.length).toBeGreaterThan(0);
    for (const [, recorded] of runKeys) expect(recorded).toEqual(["ignored/**"]);
  });
});
