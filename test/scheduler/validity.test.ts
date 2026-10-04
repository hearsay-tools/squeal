import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KnownState, StatusHeader, TestCheckId } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

const adds: TestCheckId = {
  kind: "test",
  project: "",
  testPath: "test/math.test.ts",
  fullName: "adds",
};
const PLAIN_EDITED =
  'import { expect, it } from "vitest";\n\nit("is plain", () => {\n  expect(1).toBe(1);\n});\n';

const revisionOf = (h: Harness) => h.store.revisions.latest(h.worktreeId)?.number ?? 0;

/**
 * Edits `test/plain.test.ts` so it runs in a tier of its own, and calls
 * `during` inside that tier, before Vitest starts it. Every later runner call
 * waits behind the tier, as with the real adapter.
 */
async function duringTier(h: Harness, during: () => Promise<void>): Promise<void> {
  let pending: Promise<void> | null = null;
  h.runner.beforeRun = async (files) => {
    if (pending !== null || files[0]?.path !== "test/plain.test.ts") return;
    pending = during();
    await pending;
  };
  h.write("test/plain.test.ts", PLAIN_EDITED);
  await h.batch("test/plain.test.ts");
  await h.scheduler.idle();
}

describe("scheduler: validity never lags a revision (B2)", SLOW, () => {
  it("a content edit during a tier shows pending as soon as its revision is visible", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    let header: StatusHeader | null = null;
    let state: KnownState | null = null;
    let batch: Promise<void> = Promise.resolve();
    await duringTier(h, async () => {
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
      batch = h.batch("src/math.ts");
      await waitFor(() => revisionOf(h) >= 2, 10_000);
      header = h.header();
      state = h.sink.stateOf(adds);
    });
    await batch;
    await h.scheduler.idle();

    // Read inside the tier, asserted here: a throw in beforeRun is a crashed run.
    expect(header).toMatchObject({ revision: 2, fullSuite: { atCurrentRevision: false } });
    expect(state).toMatchObject({ outcome: "pass", validity: "pending" });
    expect(h.runsOf("test/plain.test.ts").at(-1)?.report.end).toBe("completed");
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("a config edit during a tier leaves no check current at the new revision", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    let current = -1;
    let batch: Promise<void> = Promise.resolve();
    await duringTier(h, async () => {
      appendFileSync(join(h.root, "vitest.config.ts"), "// edited\n");
      batch = h.batch("vitest.config.ts");
      await waitFor(() => revisionOf(h) >= 2, 10_000);
      current = h.header().counts.current;
    });
    await batch;
    await h.scheduler.idle();

    expect(h.runsOf("test/plain.test.ts").at(-1)?.report.end).toBe("completed");
    expect(current).toBe(0);
    expect(h.header().counts.current).toBe(h.sink.states().length);
  });
});

describe("scheduler: installed lockfile (N3, N8)", SLOW, () => {
  it("a lockfile that appears without a watch batch creates a revision, so no full-suite claim stays", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 5 });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.header().fullSuite.atCurrentRevision).toBe(true);

    h.write("node_modules/.package-lock.json", '{"packages":{}}\n');
    let header: StatusHeader | null = null;
    h.runner.beforeRun = () => {
      header ??= h.header();
    };
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();

    expect(store.revisions.latest(h.worktreeId)?.changes.map((c) => c.path)).toEqual([
      "node_modules/.package-lock.json",
    ]);
    expect(header).toMatchObject({ revision: 1, fullSuite: { atCurrentRevision: false } });
    expect((header as StatusHeader | null)?.counts.current).toBe(0);
  });

  it("watches the installed lockfile of a project below the worktree root", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 5,
      environmentRoot: "packages/app",
    });
    h.write("packages/app/node_modules/.package-lock.json", '{"packages":{}}\n');
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.scheduler.extraFiles()).toContain("packages/app/node_modules/.package-lock.json");
    const before = h.keyOf("test/plain.test.ts");

    h.write("packages/app/node_modules/.package-lock.json", '{"packages":{"left-pad":"1.3.0"}}\n');
    await h.batch("packages/app/node_modules/.package-lock.json");
    await h.scheduler.idle();
    expect(h.keyOf("test/plain.test.ts")).not.toBe(before);
  });
});
