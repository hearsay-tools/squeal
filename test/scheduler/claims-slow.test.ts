import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CLAIM_RECHECK_MS } from "../../src/core/scheduler/claims.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Task 001-205 in the slow tier, by agreement with the 002/003/004
 * coordinator: a slow file whose key another live worktree runs waits
 * without taking the slot (no slot spin), and runs here once the claim ends
 * with no result; a slow file that may not inherit (004 D6) never waits; a
 * drain before exit (004-29) ends when the claimed key's result lands.
 */

const acquired = vi.hoisted(() => new Map<string, number>());

vi.mock("../../src/core/slow/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/slow/index.js")>();
  return {
    ...actual,
    acquireSlowSlot: (request: Parameters<typeof actual.acquireSlowSlot>[0]) => {
      const id = request.owner.worktreeId;
      acquired.set(id, (acquired.get(id) ?? 0) + 1);
      return actual.acquireSlowSlot(request);
    },
  };
});

const F0 = fileName(0);
const ARTIFACT = "dist/app.js";

/** `F0` is slow; with `declared`, its declared input holds the artifact it tests, so it inherits. */
function slowSide(root: string, declared: boolean, heartbeatMs?: number): Side {
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-205-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const policy: Partial<Policy> = {
    slow: { ...DEFAULT_POLICY.slow, include: [F0] },
    ...(declared ? { inputs: { [F0]: [ARTIFACT] } } : {}),
  };
  return side(root, {
    count: 1,
    policy,
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
  });
}

/** `a` runs the slow file and holds it; `b` starts and leaves it queued. */
async function heldInA(a: Side, b: Side): Promise<void> {
  a.runner.hold();
  await a.scheduler.start();
  await expect.poll(() => a.phase(F0)).toBe("running");
  await b.scheduler.start();
}

describe("claims in the slow tier (task 001-205)", { timeout: 30_000 }, () => {
  it.each([
    ["dies", (a: Side) => a.stopBeat()],
    [
      "crashes",
      (a: Side) => {
        a.runner.end = "crashed";
        a.runner.release();
      },
    ],
  ])(
    "a claimed slow file waits without taking the slot, and runs here when the claimant %s",
    async (_, end) => {
      const { main, other } = claimRepo(1, { [ARTIFACT]: "app\n" });
      const a = slowSide(main, true, 1_000);
      const b = slowSide(other, true);
      await heldInA(a, b);
      await delay(CLAIM_RECHECK_MS * 2);
      expect(b.runner.runs).toEqual([]);
      expect(b.phase(F0)).toBe("queued");
      expect(acquired.get(b.worktreeId) ?? 0).toBe(0);
      expect(b.scheduler.slowPending()).toBe(true);

      end(a);
      await expect.poll(() => b.runner.ran(F0), { timeout: 10_000 }).toBe(1);
      expect(acquired.get(b.worktreeId)).toBe(1);
      await expect.poll(() => b.passing()).toBe(1);
    },
  );

  it("a slow file that may not inherit (004 D6) never waits on a claim", async () => {
    const { main, other } = claimRepo(1, { [ARTIFACT]: "app\n" });
    const a = slowSide(main, false);
    const b = slowSide(other, false);
    await heldInA(a, b);
    expect(a.keyOf(F0)).toBe(b.keyOf(F0));
    await expect.poll(() => b.runner.ran(F0), { timeout: 10_000 }).toBe(1);
    expect(a.runner.active).toBe(1);
  });

  it("a drain of a claimed slow file ends when the claimant's result lands, unrun here (004-29)", async () => {
    const { main, other } = claimRepo(1, { [ARTIFACT]: "app\n" });
    const a = slowSide(main, true);
    const b = slowSide(other, true);
    await heldInA(a, b);
    await delay(CLAIM_RECHECK_MS);
    expect(b.scheduler.slowPending()).toBe(true);

    a.runner.release();
    await expect.poll(() => b.scheduler.slowPending(), { timeout: 5_000 }).toBe(false);
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(1);
    expect(acquired.get(b.worktreeId) ?? 0).toBe(0);
  });
});
