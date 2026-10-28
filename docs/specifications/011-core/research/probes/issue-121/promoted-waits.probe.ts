import { appendFileSync, writeFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";

import { publishedYieldRow } from "../../../../../../src/core/scheduler/yields.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import { catchUpRepo, catchUpSide } from "../../../../../../test/scheduler/catch-up-fixture.js";
import { ModelClock } from "../../../../../../test/scheduler/model-clock.js";
import { heldRun, holdRuns, ref } from "../../../../../../test/scheduler/tier-yields-fixture.js";

const observations = new URL("./observed.jsonl", import.meta.url);
beforeAll(() => writeFileSync(observations, ""));

const running = [1, 2, 3].map((i) => `test/parity-${i}.test.ts`);
const queued = "f/parity-4.test.ts";
const selection = [...running.map((path) => ref(path)), ref(queued, "f")];

async function fixture() {
  const files = [
    ...running.map((path) => ({ path, ms: 308_000, imports: ["src/s.ts"] })),
    { project: "f", path: queued, ms: 1, imports: ["src/f.ts"] },
  ];
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    policy: RUN_MISSING,
    now: new ModelClock().now,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, (path) => running.includes(path));
  await side.edit("watch", "src/s.ts", "f.config.json");
  const tier = await heldRun(side, running[0] ?? "", base);
  const revision = () => side.store.revisions.latest(side.worktreeId)?.number;
  const keys = () =>
    side.store.testFileKeys.list(side.worktreeId).map((f) => [f.testFile.path, f.key]);
  const initialKeys = keys();
  const initialRevision = revision();
  const row = () => publishedYieldRow(side.store, side.worktreeId, 0);
  const snapshot = (label: string) =>
    appendFileSync(
      observations,
      `${JSON.stringify({
        label,
        revision: revision(),
        unchangedKeys: JSON.stringify(keys()) === JSON.stringify(initialKeys),
        standings: [...row().tiers.values()],
        last: row().last,
        runs: side.runner.runs.slice(base).map((r) => ({
          files: r.files.map((f) => f.path),
          cancelled: r.cancelled,
          completed: r.completed.map((f) => f.path),
          ended: r.endedAt !== null,
        })),
      })}\n`,
    );
  const finish = async () => {
    gate.stop();
    await side.scheduler.idle();
    expect(revision()).toBe(initialRevision);
    expect(keys()).toEqual(initialKeys);
    expect(selection.every((f) => side.current(f.path))).toBe(true);
  };
  return { side, tier, base, snapshot, finish, row };
}

it("identical waits after 30 seconds preserve the running tier across expiry", async () => {
  const f = await fixture();
  f.side.advance(40_000);
  for (const elapsed of [40, 101, 162]) {
    if (elapsed !== 40) f.side.advance(61_000);
    await f.side.scheduler.promote(selection, 60_000);
    expect([...f.row().tiers.values()]).toEqual([{ kind: "named" }]);
    expect(f.tier.cancelled).toBe(false);
    f.snapshot(`same-selection-${elapsed}s`);
  }
  await f.finish();
  expect(f.side.runner.runs.slice(f.base).filter((r) => r.cancelled)).toHaveLength(0);
  f.snapshot("same-selection-finished");
}, 30_000);

it("a later wait omitting running files cuts them at 133 seconds after their promotion expires", async () => {
  const f = await fixture();
  f.side.advance(40_000);
  await f.side.scheduler.promote(selection, 60_000);
  f.side.advance(93_000);
  await f.side.scheduler.promote([ref(queued, "f")], 60_000);
  await expect.poll(() => f.tier.cancelled, { timeout: 5_000 }).toBe(true);
  await heldRun(f.side, running[0] ?? "", f.base + 1);
  expect(f.row().last?.remainderMs).toBe(175_000);
  expect((f.row().last?.at ?? 0) - (f.row().last?.runStartedAt ?? 0)).toBe(133_000);
  f.snapshot("subset-133s-cut-and-restarted");
  await f.finish();
  expect(f.side.runner.runs.slice(f.base).filter((r) => r.cancelled)).toHaveLength(1);
  f.snapshot("subset-finished");
}, 30_000);

it("before 30 seconds an overlapping wait can cut already promoted running files", async () => {
  const f = await fixture();
  // First wait covers the running files only. No queued promoted file can cut it yet.
  await f.side.scheduler.promote(
    running.map((path) => ref(path)),
    60_000,
  );
  f.side.advance(10_000);
  await f.side.scheduler.promote(selection, 60_000);
  await expect.poll(() => f.tier.cancelled, { timeout: 5_000 }).toBe(true);
  await heldRun(f.side, running[0] ?? "", f.base + 1);
  // Repeating the whole selection does not cut these keys a second time.
  await f.side.scheduler.promote(selection, 60_000);
  f.snapshot("early-cut-then-repeat");
  await f.finish();
  expect(f.side.runner.runs.slice(f.base).filter((r) => r.cancelled)).toHaveLength(1);
  f.snapshot("early-finished");
}, 30_000);
