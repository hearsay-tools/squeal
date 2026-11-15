/*
 * Throwaway probe for row 011-357: how long `acquireSlowSlot` takes and
 * returns its permits, the part of a slow lane's decision that moved into
 * the step's lock turn. A private slot directory; `want` 1 and 2 of 2
 * permits, 100 times each. One JSON line.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { it, onTestFinished } from "vitest";
import { acquireSlowSlot } from "../../../../../../src/core/slow/slot.js";
import type { AbsolutePath } from "../../../../../../src/core/types/common.js";

it("acquireSlowSlot's time", () => {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-357-slotbench-")) as AbsolutePath;
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const owner = { pid: process.pid, worktreeId: "probe" };
  const result: Record<string, { medianMs: number; p95Ms: number; maxMs: number }> = {};
  for (const want of [1, 2]) {
    const take: number[] = [];
    for (let i = 0; i < 100; i++) {
      const from = performance.now();
      const slot = acquireSlowSlot({ dir, owner, permits: 2, want, group: "g0" });
      take.push(performance.now() - from);
      slot?.release();
    }
    take.sort((a, b) => a - b);
    const ms = (q: number) => Math.round((take[Math.floor(q * (take.length - 1))] ?? 0) * 1000) / 1000;
    result[`want ${want}`] = { medianMs: ms(0.5), p95Ms: ms(0.95), maxMs: ms(1) };
  }
  console.log(JSON.stringify({ probe: "011-357 slot", load: loadavg()[0], ...result }));
});
