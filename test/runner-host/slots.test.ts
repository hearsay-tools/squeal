import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  expandedVariables,
  expandSlotTemplate,
  SlotPool,
  slotOf,
  slotPool,
  slotVariables,
  worktreeSlotToken,
} from "../../src/core/runner-host/slots.js";

/*
 * Spec 027 D1, D2 (row 027-02): the slot allocator, the worktree token and
 * the `env` templating, without a process.
 */

const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-slots-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SLOT = { slot: 3, worktreeSlot: "abcd1234_3" };

/** The slots among `1..upTo` that `pool` holds now: every free one is taken, then given back. */
async function heldOf(pool: SlotPool, upTo: number): Promise<number[]> {
  const taken: number[] = [];
  for (let slot = await pool.acquire(AbortSignal.timeout(50)); slot !== null; ) {
    taken.push(slot);
    slot = slot > upTo ? null : await pool.acquire(AbortSignal.timeout(50));
  }
  for (const slot of taken) pool.release(slot);
  return Array.from({ length: upTo }, (_, i) => i + 1).filter((n) => !taken.includes(n));
}

describe("SlotPool (027 D1.1)", () => {
  it("gives the lowest free slot from 1 and gives a released slot again", async () => {
    const pool = new SlotPool();
    expect([await pool.acquire(), await pool.acquire(), await pool.acquire()]).toEqual([1, 2, 3]);
    pool.release(2);
    expect(await pool.acquire()).toBe(2);
    expect(await heldOf(pool, 3)).toEqual([1, 2, 3]);
  });

  it("never gives a slot above max: an acquire waits for a release", async () => {
    const pool = new SlotPool(2);
    await pool.acquire();
    await pool.acquire();
    let third: number | null | undefined;
    const waiting = pool.acquire().then((slot) => {
      third = slot;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(third).toBeUndefined();
    pool.release(1);
    await waiting;
    expect(third).toBe(1);
    expect(await heldOf(pool, 2)).toEqual([1, 2]);
  });

  it("stops a waiting acquire with null when its signal aborts", async () => {
    const pool = new SlotPool(1);
    await pool.acquire();
    const stop = new AbortController();
    const waiting = pool.acquire(stop.signal);
    stop.abort();
    expect(await waiting).toBeNull();
    expect(await heldOf(pool, 1)).toEqual([1]);
    expect(await pool.acquire(stop.signal)).toBeNull();
  });

  it("ignores a release of a slot not held", async () => {
    const pool = new SlotPool();
    pool.release(4);
    expect(await heldOf(pool, 3)).toEqual([]);
  });

  it("is one pool per worktree, project and cap", () => {
    const a = slotPool(dir, "unit-a", 1);
    expect(slotPool(dir, "unit-a", 1)).toBe(a);
    expect(slotPool(dir, "unit-a", 2)).not.toBe(a);
    expect(slotPool(dir, "unit-a")).not.toBe(a);
    expect(slotPool(dir, "unit-b", 1)).not.toBe(a);
  });
});

describe("worktreeSlotToken (027 D1.2)", () => {
  it("is the first 8 hex characters of SHA-256 of the worktree's path", () => {
    const expected = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(worktreeSlotToken(dir)).toBe(expected);
    expect(slotOf(dir, 2)).toEqual({ slot: 2, worktreeSlot: `${expected}_2` });
  });

  it("differs between two worktrees", () => {
    expect(worktreeSlotToken(join(dir, "a"))).not.toBe(worktreeSlotToken(join(dir, "b")));
  });
});

describe("expandSlotTemplate (027 D2.1, D2.3)", () => {
  it.each([
    ["redis://127.0.0.1:6379/{slot}", "redis://127.0.0.1:6379/3"],
    ["db{slot0}", "db2"],
    ["test_{worktreeSlot}", "test_abcd1234_3"],
    ["{slot}-{slot}-{slot0}", "3-3-2"],
    ['{"dbname":"workers_{worktreeSlot}"}', '{"dbname":"workers_abcd1234_3"}'],
    ['{"port":5432,"x":"{slot1}"}', '{"port":5432,"x":"{slot1}"}'],
    ["{Slot} {SLOT} { slot } {{slot}}", "{Slot} {SLOT} { slot } {3}"],
    ["no placeholder", "no placeholder"],
  ])("expands %j to %j", (value, expected) => {
    expect(expandSlotTemplate(value, SLOT)).toBe(expected);
  });
});

describe("slotVariables (027 D1.3)", () => {
  it("exports SQUEAL_SLOT and SQUEAL_WORKTREE_SLOT, TOX_PARALLEL_ENV only when asked", () => {
    expect(slotVariables(SLOT, false)).toEqual({
      SQUEAL_SLOT: "3",
      SQUEAL_WORKTREE_SLOT: "abcd1234_3",
    });
    expect(slotVariables(SLOT, true)).toEqual({
      SQUEAL_SLOT: "3",
      SQUEAL_WORKTREE_SLOT: "abcd1234_3",
      TOX_PARALLEL_ENV: "abcd1234_3",
    });
  });
});

describe("expandedVariables (027 D2.1)", () => {
  it("expands each template the environment still holds, and leaves an overridden one", () => {
    const templates = { A: "a{slot}", B: "b{slot}", C: "plain", E: "e{slot}" };
    const env = { A: "a{slot}", B: "set by another source", C: "plain", D: "d{slot}" };
    expect(expandedVariables(env, templates, SLOT)).toEqual({
      A: "a3",
      B: "set by another source",
      C: "plain",
    });
  });

  it("expands a template's entries in a path list composed around it (review 0.1.642 B2)", () => {
    const templates = {
      PATH: ["/usr/bin", "/tools/{slot}"].join(delimiter),
      PYTHONPATH: "/gen/{worktreeSlot}",
      DB: '{"n":{slot0},"x":"{slot}"}',
    };
    const env = {
      PATH: ["/env/bin", "/usr/bin", "/tools/{slot}"].join(delimiter),
      PYTHONPATH: ["/gen/{worktreeSlot}", "/runtime/{slot}"].join(delimiter),
      DB: templates.DB,
    };
    expect(expandedVariables(env, templates, SLOT)).toEqual({
      PATH: ["/env/bin", "/usr/bin", "/tools/3"].join(delimiter),
      PYTHONPATH: ["/gen/abcd1234_3", "/runtime/{slot}"].join(delimiter),
      DB: '{"n":2,"x":"3"}',
    });
  });
});
