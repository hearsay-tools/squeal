import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DaemonNote,
  notesMetaKey,
  type Store,
  type TestCheckId,
} from "../../src/core/types/index.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

const adds: TestCheckId = {
  kind: "test",
  project: "",
  testPath: "test/math.test.ts",
  fullName: "adds",
};

function notes(store: Store, worktreeId: string): DaemonNote[] {
  const raw = store.meta.get(notesMetaKey(worktreeId));
  return raw === null ? [] : (JSON.parse(raw) as DaemonNote[]);
}

function rows(h: Harness) {
  return h.store.testFileKeys.list(h.worktreeId).map((r) => [r.testFile.path, r.key, r.pending]);
}

/*
 * Spec 001 D5: "A runner call that fails is a state, never a skip: when
 * environment, invalidation or closure resolution fails for a project, every
 * test file of that project becomes `unknown` at this revision with the
 * runner's message as the reason, one factual line is delivered, and a note
 * is persisted for status." Review wave 2, B1.
 */
describe("scheduler: a runner failure is a state (B1)", SLOW, () => {
  it("a broken config makes every check unknown, persists a note and claims no full suite", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { allowErrors: true });
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();
    const known = h.sink.states().length;
    const runs = h.runner.runs.length;
    expect(h.header().fullSuite.atCurrentRevision).toBe(true);

    const config = readFileSync(join(h.root, "vitest.config.ts"), "utf8");
    h.write("vitest.config.ts", "export default {;\n");
    await h.batch("vitest.config.ts");
    await h.scheduler.idle();

    const header = h.header();
    expect(header.revision).toBe(1);
    expect(header.counts).toEqual({ current: 0, pending: 0, stale: 0, unknown: known });
    expect(header.fullSuite.atCurrentRevision).toBe(false);
    expect(h.runner.runs.length).toBe(runs);
    // Rows stay; nothing is retired.
    expect(rows(h).map(([path]) => path)).toEqual(ALL_TEST_FILES);
    expect(h.sink.callsOf("retire")).toEqual([]);

    const delta = await delivery.onToolBoundary(consumer);
    expect(delta?.entries).toHaveLength(known);
    expect(new Set(delta?.entries.map((e) => e.kind))).toEqual(new Set(["to-unknown"]));
    const reasons = new Set(delta?.entries.map((e) => e.summary));
    expect(reasons.size).toBe(1);
    expect([...reasons][0]).toMatch(/\S/);

    const persisted = notes(store, h.worktreeId);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.at(-1)).toMatchObject({ revision: 1, at: expect.any(Number) });
    // N2: the note names the paths of the failed call.
    expect(persisted.some((n) => n.text.includes("vitest.config.ts"))).toBe(true);

    h.write("vitest.config.ts", config);
    await h.batch("vitest.config.ts");
    await h.scheduler.idle();
    expect(h.header().counts).toEqual({ current: known, pending: 0, stale: 0, unknown: 0 });
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("a restart whose runner rejects keeps the test files, marks them unknown and abandons the baseline", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir);
    await first.scheduler.start();
    await first.scheduler.idle();
    await first.scheduler.close();
    await first.runner.close();
    const known = first.sink.states().length;

    // Something changed while no daemon ran.
    first.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    const second = await openHarness(repo.main, store, repo.commonDir, {
      failing: ["environment", "testFiles"],
      allowErrors: true,
    });
    await second.scheduler.start();
    await second.scheduler.idle();

    expect(second.runner.runs).toEqual([]);
    // Nothing retired, every row kept without a key.
    expect(second.sink.states()).toHaveLength(known);
    expect(rows(second)).toEqual(ALL_TEST_FILES.map((path) => [path, null, null]));
    const header = second.header();
    expect(header.revision).toBe(1);
    expect(header.counts).toEqual({ current: 0, pending: 0, stale: 0, unknown: known });
    expect(header.fullSuite.atCurrentRevision).toBe(false);
    const baseline = store.checkpoints.get(
      store.runs.get(first.runner.runs[0]?.options.runId ?? "")?.checkpointId ?? "",
    );
    expect(baseline?.end).toBe("completed");
    expect(store.checkpoints.lastCompleted(second.worktreeId)?.id).toBe(baseline?.id);
    expect(
      notes(store, second.worktreeId)
        .map((n) => n.text)
        .join("\n"),
    ).toMatch(/environment/);

    // The runner works again: the next batch recovers every file.
    second.runner.failing.clear();
    second.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await second.batch("src/math.ts");
    await second.scheduler.idle();
    expect(second.header().counts).toEqual({ current: known, pending: 0, stale: 0, unknown: 0 });
    expect(second.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual([
      "test/math.test.ts",
      "test/strings.test.ts",
      "test/upper.test.ts",
    ]);
  });

  it("a failed listing retires nothing and is retried with the next revision", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { allowErrors: true });
    await h.scheduler.start();
    await h.scheduler.idle();
    const known = h.sink.states().length;

    h.runner.failing.add("testFiles");
    h.write("test/extra.test.ts", 'import { it } from "vitest";\nit("is extra", () => {});\n');
    await h.batch("test/extra.test.ts");
    await h.scheduler.idle();
    expect(h.sink.callsOf("retire")).toEqual([]);
    expect(h.sink.states()).toHaveLength(known);
    expect(notes(store, h.worktreeId).some((n) => n.text.includes("testFiles"))).toBe(true);

    h.runner.failing.clear();
    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runsOf("test/extra.test.ts")).toHaveLength(1);
    expect(h.sink.callsOf("retire")).toEqual([]);
  });

  it("a failed closure makes the project unknown and the note names the test file (N2)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { allowErrors: true });
    await h.scheduler.start();
    await h.scheduler.idle();
    const known = h.sink.states().length;

    h.runner.failing.add("closure");
    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();

    expect(h.header().counts.unknown).toBe(known);
    expect(notes(store, h.worktreeId).some((n) => n.text.includes("test/math.test.ts"))).toBe(true);
  });

  it("run --all includes unkeyed files and ends abandoned", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      failing: ["environment"],
      allowErrors: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(rows(h)).toEqual(ALL_TEST_FILES.map((path) => [path, null, null]));
    expect(store.checkpoints.lastCompleted(h.worktreeId)).toBeNull();

    const checkpoint = await h.scheduler.requestFullSuite();
    await h.scheduler.idle();
    expect(checkpoint.testFiles.map((f) => f.path).sort()).toEqual(ALL_TEST_FILES);
    expect(store.checkpoints.get(checkpoint.id)?.end).toBe("abandoned");
    expect(h.runner.runs).toEqual([]);
    expect(h.scheduler.status().testFiles.unknown).toBe(5);
  });
});
