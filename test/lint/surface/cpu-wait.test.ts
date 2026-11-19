import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundCeiling } from "../../../src/core/capacity/background.js";
import {
  CPU_WAIT_REFRESH_MS,
  readCpuWait,
  refusedCpu,
} from "../../../src/core/lint/pass/cpu-wait.js";
import { lintScope } from "../../../src/core/lint/pass/records.js";
import type { LintCapacity } from "../../../src/core/lint/pass/types.js";
import { registerLint } from "../../../src/core/lint/surface/deliver.js";
import { lintRegistrationLine, lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { lintStatus } from "../../../src/core/lint/surface/report.js";
import {
  CAPACITY_RECHECK_MS,
  TierCapacity,
  WAIT_FOR_CAPACITY,
} from "../../../src/core/scheduler/capacity.js";
import { SLOT_WAITER_FRESH_MS } from "../../../src/core/slow/slot-files.js";
import type { EpochMs } from "../../../src/core/types/common.js";
import { FakeProvider, lintPass, lintTree, storeOf } from "../pass/helpers.js";
import { consumer, sourceOf } from "./helpers.js";

/*
 * Row 017-33 (gh-238, spec 017 D7, D9): while the pool refuses the lint
 * parts' background lease, status text and JSON name the wait for CPU with
 * the busy CPUs and the limit the pool read; a granted lease shows none.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A pool that refuses or grants as `refuse` says, reading 21 busy CPUs against a limit of 18. */
function stubPool(refuse: { now: boolean }): LintCapacity {
  return {
    take: () => (refuse.now ? WAIT_FOR_CAPACITY : { release() {} }),
    running: () => () => {},
    backgroundGate: () => ({ busy: 21.4, limit: 18 }),
  };
}

describe("lint status names its wait for CPU (row 017-33)", () => {
  it("a refused lease shows the wait in text and JSON; a granted one shows none", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    tree.revise();
    const refuse = { now: true };
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider, {
      capacity: () => stubPool(refuse),
      now: () => Date.now() as EpochMs,
    });
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toEqual([]);

    const status = lintStatus(sourceOf(tree), tree.id, null);
    expect(status?.linting).toEqual({
      done: 0,
      total: 2,
      cpuWait: { since: expect.any(Number), busy: 21.4, limit: 18 },
    });
    expect(JSON.parse(JSON.stringify(status)).linting.cpuWait).toMatchObject({
      busy: 21.4,
      limit: 18,
    });
    expect(lintStatusLines(defined(status), "squeal")[0]).toBe(
      "Lint: linting, 0 of 2 files; waiting for CPU (21 busy, limit 18).",
    );
    const reg = registerLint(sourceOf(tree), consumer(tree), Date.now() as EpochMs);
    expect(lintRegistrationLine(defined(reg), "squeal")).toBe(
      "Lint: linting, 0 of 2 files; waiting for CPU (21 busy, limit 18).",
    );

    refuse.now = false;
    await vi.advanceTimersByTimeAsync(CAPACITY_RECHECK_MS);
    await pass.idle();
    expect(provider.calls.length).toBeGreaterThan(0);
    const after = lintStatus(sourceOf(tree), tree.id, null);
    expect(after?.linting?.cpuWait).toBeUndefined();
    expect(lintStatusLines(defined(after), "squeal").join("\n")).not.toContain("waiting for CPU");
    await pass.close();
  });

  it("a granted lease never records a wait", async () => {
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    let open = () => {};
    provider.gate = new Promise((resolve) => {
      open = resolve;
    });
    const { pass } = lintPass(tree, provider, {
      capacity: () => stubPool({ now: false }),
      now: () => Date.now() as EpochMs,
    });
    pass.nudge();
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const during = lintStatus(sourceOf(tree), tree.id, null);
    expect(during?.linting).toEqual({ done: 0, total: 1 });
    open();
    await pass.close();
  });

  it("keeps the wait's start, renews its numbers each refresh, and forgets it once not renewed", () => {
    const tree = lintTree();
    const store = storeOf(tree);
    cleanups.push(() => store.close());
    const scope = lintScope(tree.id, "eslint");
    const at = (ms: number) => ms as EpochMs;
    refusedCpu(store.meta, scope, { busy: 21, limit: 18 }, at(1_000));
    refusedCpu(store.meta, scope, { busy: 25, limit: 18 }, at(1_000 + CPU_WAIT_REFRESH_MS - 1));
    expect(readCpuWait(store.meta, scope, at(5_000))).toEqual({
      since: 1_000,
      busy: 21,
      limit: 18,
    });
    refusedCpu(store.meta, scope, { busy: null, limit: 18 }, at(1_000 + CPU_WAIT_REFRESH_MS));
    const at2 = 1_000 + CPU_WAIT_REFRESH_MS;
    expect(readCpuWait(store.meta, scope, at(at2))).toEqual({
      since: 1_000,
      busy: null,
      limit: 18,
    });
    expect(readCpuWait(store.meta, scope, at(at2 + SLOT_WAITER_FRESH_MS + 1))).toBeNull();
    // A pool that read no gate records nothing.
    const other = lintScope(tree.id, "oxlint");
    refusedCpu(store.meta, other, null, at(1_000));
    expect(readCpuWait(store.meta, other, at(1_000))).toBeNull();
  });

  it("the scheduler's pool reports the ceiling it refuses at (TierCapacity.backgroundGate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-lint-cpu-"));
    const capacity = new TierCapacity(
      { dir, hostSlots: 1, host: null, backgroundShare: 0.5 },
      "w1",
      () => {},
    );
    cleanups.push(() => {
      capacity.close();
      rmSync(dir, { recursive: true, force: true });
    });
    expect(capacity.backgroundGate()).toBeNull();
    capacity.take(1, "slow", 1, "backlog");
    const gate = capacity.backgroundGate();
    expect(gate?.limit).toBe(backgroundCeiling(0.5, availableParallelism()));
  });
});

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("lint is off or its store unreadable");
  return value;
}
