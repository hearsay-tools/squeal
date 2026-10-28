import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import type { Policy } from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";
import { A, B, DATA, fixture, scoped, text } from "./runtime-files-fixture.js";

const slowPolicy: Policy = {
  ...scoped,
  slow: { ...scoped.slow, trigger: "idle", include: [A, B], maxParallel: 1 },
};

async function settled(h: Harness) {
  await expect
    .poll(
      () => {
        const rows = h.store.testFileKeys.list(h.worktreeId);
        return rows.length === 2 && rows.every((row) => row.pending === null);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await idleAfterQuiet(h);
}

function passed(h: Harness, path: string) {
  expect(h.keyOf(path)).not.toBeNull();
  const results = h.store.results.byKey(h.keyOf(path));
  expect(results).toHaveLength(2);
  expect(results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        check: expect.objectContaining({ kind: "test" }),
        outcome: "pass",
      }),
      expect.objectContaining({
        check: expect.objectContaining({ kind: "file" }),
        outcome: "pass",
      }),
    ]),
  );
  return results;
}

function holdFirst(h: Harness) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = { path: "", runId: "", release: () => release() };
  onTestFinished(() => release());
  h.gate.before = async (files, options) => {
    if (held.runId !== "") return;
    held.path = files[0]?.path ?? "";
    held.runId = options.runId;
    await gate;
  };
  return held;
}

it("stores both slow readers once at their effective keys", SLOW, async () => {
  const repo = fixture(false);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    policy: slowPolicy,
    slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
  });
  await h.scheduler.start();
  await settled(h);
  const raw = JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}");
  for (const path of [A, B]) {
    expect(h.runsOf(path)).toHaveLength(1);
    expect(raw[path]).toContain(DATA);
    passed(h, path);
  }
  expect(h.scheduler.extraFiles()).not.toContain(DATA);
  expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
});

it.each([
  { name: "slow scoped", slow: true, scoped: true, rewrite: true },
  { name: "fast scoped", slow: false, scoped: true, rewrite: true },
  { name: "slow unscoped", slow: true, scoped: false, rewrite: false },
])("stores passing $name readers and drains the queue", SLOW, async (control) => {
  const repo = fixture(false);
  const store = openRepoStore(repo.commonDir);
  const policy = {
    ...slowPolicy,
    runtimeFiles: control.scoped ? scoped.runtimeFiles : [],
    slow: { ...slowPolicy.slow, include: control.slow ? [A, B] : [] },
  };
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    policy,
    slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
  });
  let writes = 0;
  const selected = new Map<string, string | null>();
  h.runner.beforeRun = (files) => {
    for (const { path } of files) if (!selected.has(path)) selected.set(path, h.keyOf(path));
    if (control.rewrite) h.write(DATA, text(2000 + ++writes));
  };
  await h.scheduler.start();
  await settled(h);
  const raw = JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}");
  for (const path of [A, B]) {
    passed(h, path);
    expect(raw[path]).toContain(DATA);
    const runs = h.runsOf(path);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(control.scoped ? 1 : 2);
    if (control.scoped) expect(h.keyOf(path)).toBe(selected.get(path));
    expect(runs.every((run) => run.report.end === "completed")).toBe(true);
    if (control.slow) expect(runs.every((run) => run.files.length === 1)).toBe(true);
  }
  expect(h.scheduler.extraFiles().includes(DATA)).toBe(!control.scoped);
  expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
});

it(
  "stores slow readers when real global setup rewrites the excluded descriptor",
  SLOW,
  async () => {
    const repo = fixture(false);
    writeFileSync(
      join(repo.main, "vitest.config.ts"),
      'export default { test: { include: ["test/**/*.test.ts"], globalSetup: ["./global-setup.ts"] } };\n',
    );
    writeFileSync(
      join(repo.main, "global-setup.ts"),
      [
        'import { writeFileSync } from "node:fs";',
        'export default () => writeFileSync(new URL("./.runtime/descriptor.json", import.meta.url),',
        "  JSON.stringify({ port: Date.now() }));",
        "",
      ].join("\n"),
    );
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: slowPolicy,
      slowInstance: true,
      slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await settled(h);
    expect(JSON.parse(readFileSync(join(repo.main, DATA), "utf8")).port).toBeGreaterThan(1234);
    const raw = JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}");
    for (const path of [A, B]) {
      expect(h.runsOf(path)).toHaveLength(1);
      expect(raw[path]).toContain(DATA);
      passed(h, path);
    }
    expect(h.scheduler.extraFiles()).not.toContain(DATA);
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
  },
);

it.each([true, false])(
  "rejects a held slow run after its runtime policy changes (observe=%s)",
  SLOW,
  async (observe) => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const next: Policy = { ...slowPolicy, runtimeFiles: [] };
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe,
      policy: slowPolicy,
      runnerPartBesideRun: true,
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? next : null,
      slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
    });
    const held = holdFirst(h);
    await h.scheduler.start();
    await expect.poll(() => held.runId, { timeout: 5000 }).not.toBe("");
    const oldKey = h.keyOf(held.path);
    try {
      h.write("squeal.config.json", "{}\n");
      await h.batch("squeal.config.json");
      expect(h.keyOf(held.path)).not.toBe(oldKey);
    } finally {
      held.release();
    }
    await settled(h);
    expect(store.results.byKey(oldKey)).toEqual([]);
    for (const path of [A, B])
      expect(passed(h, path).every((r) => r.provenance.runId !== held.runId)).toBe(true);
    expect(h.scheduler.extraFiles().includes(DATA)).toBe(observe);
  },
);

it("discards a slow pass when a meaningful input changes during the run", SLOW, async () => {
  const repo = fixture(false);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    policy: { ...slowPolicy, inputs: { [A]: ["src/math.ts"], [B]: ["src/math.ts"] } },
    slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
  });
  const held = holdFirst(h);
  await h.scheduler.start();
  await expect.poll(() => held.runId, { timeout: 5000 }).not.toBe("");
  const oldKey = h.keyOf(held.path);
  // No watcher batch: the completion barrier must find this keyed input on disk.
  h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // changed\n");
  held.release();
  await settled(h);
  expect(h.keyOf(held.path)).not.toBe(oldKey);
  expect(store.results.byKey(oldKey)).toEqual([]);
  expect(passed(h, held.path).every((r) => r.provenance.runId !== held.runId)).toBe(true);
  expect(h.runsOf(held.path)).toHaveLength(2);
  expect(h.scheduler.extraFiles()).not.toContain(DATA);
});
