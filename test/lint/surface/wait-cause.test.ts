import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostCpu } from "../../../src/core/capacity/cores.js";
import { writeMark } from "../../../src/core/capacity/marks.js";
import {
  CPU_WAIT_REFRESH_MS,
  cpuWaitKey,
  readCpuWait,
  refusedCpu,
} from "../../../src/core/lint/pass/cpu-wait.js";
import { lintScope } from "../../../src/core/lint/pass/records.js";
import { lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { lintStatus } from "../../../src/core/lint/surface/report.js";
import { TierCapacity } from "../../../src/core/scheduler/capacity.js";
import type { EpochMs } from "../../../src/core/types/common.js";
import { FakeProvider, lintPass, lintTree, storeOf } from "../pass/helpers.js";
import { sourceOf } from "./helpers.js";

/*
 * Row 017-37 (gh-238, research/lint-gate-stall.md F3): a refusal the CPU
 * ceiling did not cause is recorded with its cause, and status names that
 * cause with no CPU numbers. The pool is the scheduler's, over 24 CPUs: the
 * limit is 18 busy.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const host = (cores: number): HostCpu => ({ read: () => cores });

/** A pool directory where the project's other daemon holds the project's one slot. */
function sharedOut(worktreeId: string, busy: number): TierCapacity {
  const root = mkdtempSync(join(tmpdir(), "squeal-lint-cause-"));
  const dir = join(root, "pool");
  mkdirSync(dir, { mode: 0o700 });
  const project = { id: "p", slots: 1 };
  writeMark(dir, { id: "runs", want: 1, grant: 1, since: null, cores: 1, background: 1 });
  writeMark(dir, { id: "sibling", want: 1, grant: 1, since: null, project, background: 1 });
  const capacity = new TierCapacity(
    { dir, hostSlots: 4, cpus: 24, host: host(busy), project },
    worktreeId,
    () => {},
  );
  cleanups.push(() => {
    capacity.close();
    rmSync(root, { recursive: true, force: true });
  });
  return capacity;
}

describe("a lint wait names its real cause (row 017-37)", () => {
  it("a share refusal with busy CPUs below the limit names the share and no CPU numbers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    tree.revise();
    const capacity = sharedOut(tree.id, 3);
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider, {
      capacity: () => capacity,
      now: () => Date.now() as EpochMs,
    });
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toEqual([]);
    const status = lintStatus(sourceOf(tree), tree.id, null);
    expect(status?.linting?.cpuWait?.cause).toBe("share");
    expect(status?.linting?.cpuWait?.busy).toBeLessThan(18);
    const line = lintStatusLines(status ?? fail(), "squeal")[0];
    expect(line).toBe(
      "Lint: linting, 0 of 2 files; waiting for this worktree's share of the worker pool.",
    );
    expect(line).not.toMatch(/CPU|busy|limit/);
    await pass.close();
  });

  it("a queue refusal names the line, and a cause that changes is written at once", () => {
    const tree = lintTree();
    const store = storeOf(tree);
    cleanups.push(() => store.close());
    const scope = lintScope(tree.id, "eslint");
    const at = (ms: number) => ms as EpochMs;
    refusedCpu(store.meta, scope, { busy: 4, limit: 18, refusal: "queue" }, at(1_000));
    expect(readCpuWait(store.meta, scope, at(1_000))?.cause).toBe("queue");
    refusedCpu(store.meta, scope, { busy: 19, limit: 18, refusal: "ceiling" }, at(1_500));
    expect(readCpuWait(store.meta, scope, at(1_500))).toEqual({
      since: 1_000,
      busy: 19,
      limit: 18,
      cause: "ceiling",
    });
    // The same cause within the refresh keeps the record as it was.
    refusedCpu(store.meta, scope, { busy: 30, limit: 18, refusal: "ceiling" }, at(2_000));
    expect(readCpuWait(store.meta, scope, at(2_000))?.busy).toBe(19);
    refusedCpu(
      store.meta,
      scope,
      { busy: 30, limit: 18, refusal: "ceiling" },
      at(1_500 + CPU_WAIT_REFRESH_MS),
    );
    expect(readCpuWait(store.meta, scope, at(1_500 + CPU_WAIT_REFRESH_MS))?.busy).toBe(30);
  });

  it("a record an older daemon wrote, with no cause, reads as the ceiling's", () => {
    const tree = lintTree();
    const store = storeOf(tree);
    cleanups.push(() => store.close());
    const scope = lintScope(tree.id, "eslint");
    store.meta.set(cpuWaitKey(scope), JSON.stringify({ since: 1, at: 1, busy: 20, limit: 18 }));
    expect(readCpuWait(store.meta, scope, 2 as EpochMs)?.cause).toBe("ceiling");
  });
});

function fail(): never {
  throw new Error("lint is off or its store unreadable");
}
