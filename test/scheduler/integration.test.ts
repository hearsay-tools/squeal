import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileCheckId, TestCheckId } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

const adds: TestCheckId = {
  kind: "test",
  project: "",
  testPath: "test/math.test.ts",
  fullName: "adds",
};
const BROKEN_ADD = "export const add = (a: number, b: number) => a - b;\n";
const FIXED_ADD = "export const add = (a: number, b: number) => a + b;\n";

/*
 * The scheduler, the real StateSink and the real HarnessDelivery together
 * (review wave 2, S7). Spec 001 Testing: "edit a source file and assert
 * exactly one `PASS -> FAIL` delivery, then exactly one `FAIL -> PASS`; break
 * and recover between deliveries and assert silence".
 */
describe("scheduler with state and delivery", SLOW, () => {
  it("break, fix, and break-and-recover deliver one PASS -> FAIL, one FAIL -> PASS, then nothing", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();

    h.write("src/math.ts", BROKEN_ADD);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const broken = await delivery.onToolBoundary(consumer);
    expect(broken?.entries.map((e) => [e.check, e.kind])).toEqual([[adds, "pass-to-fail"]]);
    // S8: the default describer is describeFailure, so stored failures carry a fingerprint.
    const failed = store.results
      .byKey(h.keyOf("test/math.test.ts"))
      .filter((r) => r.outcome === "fail");
    expect(failed.map((r) => r.fingerprint)).toEqual([
      expect.stringMatching(/@ test\/math\.test\.ts:/),
    ]);

    h.write("src/math.ts", FIXED_ADD);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const fixed = await delivery.onToolBoundary(consumer);
    expect(fixed?.entries.map((e) => [e.check, e.kind])).toEqual([[adds, "fail-to-pass"]]);

    h.write("src/math.ts", BROKEN_ADD);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    h.write("src/math.ts", FIXED_ADD);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
  });

  it("a fixed file-level failure is delivered as FAIL -> PASS (S1)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();
    const fileCheck: FileCheckId = { kind: "file", project: "", testPath: "test/new.test.ts" };

    h.write("test/new.test.ts", 'import { it } from "vitest";\nit("is new", () => {\n');
    await h.batch("test/new.test.ts");
    await h.scheduler.idle();
    const broken = await delivery.onToolBoundary(consumer);
    expect(broken?.entries.map((e) => [e.check, e.kind])).toEqual([[fileCheck, "first-seen-fail"]]);

    h.write("test/new.test.ts", 'import { it } from "vitest";\nit("is new", () => {});\n');
    await h.batch("test/new.test.ts");
    await h.scheduler.idle();
    const fixed = await delivery.onToolBoundary(consumer);
    expect(fixed?.entries.map((e) => [e.check, e.kind])).toEqual([[fileCheck, "fail-to-pass"]]);
    expect(h.sink.stateOf(fileCheck)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("a restarted daemon queues a known failure first", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir);
    await first.scheduler.start();
    await first.scheduler.idle();
    first.write("src/math.ts", BROKEN_ADD);
    await first.batch("src/math.ts");
    await first.scheduler.idle();
    await first.scheduler.close();
    await first.runner.close();

    // Every key moves while no daemon runs; the failure stays.
    appendFileSync(join(first.root, "vitest.config.ts"), "// edited\n");
    const second = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await second.scheduler.start();
    await second.scheduler.idle();

    expect(second.runner.runs.map((r) => r.files)).toHaveLength(5);
    expect(second.runner.runs[0]?.files).toEqual([ref("test/math.test.ts")]);
    expect(second.sink.stateOf(adds)).toMatchObject({ outcome: "fail", validity: "current" });
  });

  it("a revision during a tier moves a failing file ahead of files queued before it", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    h.write("src/math.ts", BROKEN_ADD);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const before = h.runner.runs.length;

    let during: Promise<void> | null = null;
    h.runner.beforeRun = async (files) => {
      if (during !== null || files[0]?.path !== "test/plain.test.ts") return;
      h.write("src/math.ts", "export const add = (a: number, b: number) => a * b;\n");
      during = h.batch("src/math.ts");
      await waitFor(() => (store.revisions.latest(h.worktreeId)?.number ?? 0) >= 3, 10_000);
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    h.write(
      "test/plain.test.ts",
      'import { expect, it } from "vitest";\n\nit("is plain", () => {\n  expect(1).toBe(1);\n});\n',
    );
    await h.batch("src/strings.ts", "test/plain.test.ts");
    await h.scheduler.idle();
    await during;
    await h.scheduler.idle();

    const order = h.runner.runs.slice(before).map((r) => r.files.map((f) => f.path));
    expect(order.slice(0, 2)).toEqual([["test/plain.test.ts"], ["test/math.test.ts"]]);
    expect(order.slice(2).flat().sort()).toEqual(["test/strings.test.ts", "test/upper.test.ts"]);
  });
});
