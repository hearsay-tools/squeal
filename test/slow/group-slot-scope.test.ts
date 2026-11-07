import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPermitPool } from "../../src/core/capacity/pool.js";
import { repositoryId } from "../../src/core/daemon/scratch.js";
import { acquireSlowSlot } from "../../src/core/slow/slot.js";
import {
  DEFAULT_GROUP_SLOT_SCOPE,
  markSlotWaiter,
  othersWaitingForSlot,
  slotFiles,
} from "../../src/core/slow/slot-files.js";

/*
 * Spec 019 D3 as the human decided it, 2026-11-03: a group's `maxParallel`
 * counts per repository by default, all its worktrees together; the host
 * config's `capacity.groupSlotScope: "user"` counts it across every
 * repository of the user, in today's files.
 */

let root: string;
/** The slot's base directory, `slowSlotDir()`. */
let base: string;
/** Two repositories' common dirs. */
let commonA: string;
let commonB: string;
const owner = { pid: process.pid, worktreeId: "a" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-slot-scope-test-"));
  base = join(root, "squeal-uid");
  commonA = join(root, "a", ".git");
  commonB = join(root, "b", ".git");
  mkdirSync(commonA, { recursive: true });
  mkdirSync(commonB, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a group slot's scope (spec 019 D3, capacity.groupSlotScope)", () => {
  test("scope user is today's directory and files, byte for byte", () => {
    for (const group of ["slow", "e2e"]) {
      expect(slotFiles(group, "user").dir(base, commonA)).toBe(base);
      expect(slotFiles(group, "user").dir(base, commonB)).toBe(base);
    }
    const dir = slotFiles("slow", "user").dir(base, commonA);
    const slot = acquireSlowSlot({ dir, owner, permits: 2, want: 2 });
    markSlotWaiter(dir, "b");
    const waiter = `slow.wait.${createHash("sha256").update("b").digest("hex").slice(0, 16)}`;
    expect(readdirSync(base).sort()).toEqual([
      "slow.1.lock",
      "slow.1.lock-journal",
      "slow.lock",
      "slow.lock-journal",
      waiter,
    ]);
    slot?.release();
  });

  test("scope repository is the default, a directory per repository named by its hashed id", () => {
    expect(DEFAULT_GROUP_SLOT_SCOPE).toBe("repository");
    const key = createHash("sha256").update(repositoryId(commonA)).digest("hex").slice(0, 16);
    expect(slotFiles("e2e").dir(base, commonA)).toBe(join(base, `repo.${key}`));
    expect(slotFiles("slow", "repository").dir(base, commonA)).toBe(join(base, `repo.${key}`));
    expect(slotFiles("e2e").dir(base, commonB)).not.toBe(join(base, `repo.${key}`));
  });

  test("scope repository gives two repositories independent permits for one group name", () => {
    for (const group of ["slow", "e2e"]) {
      const inA = slotFiles(group).dir(base, commonA);
      const inB = slotFiles(group).dir(base, commonB);
      const a = acquireSlowSlot({ dir: inA, owner, group });
      expect(a?.permits).toBe(1);
      const b = acquireSlowSlot({ dir: inB, owner, group });
      expect(b?.permits).toBe(1);
      // Another worktree of repository a shares its common dir, so its slot.
      expect(
        acquireSlowSlot({ dir: slotFiles(group).dir(base, commonA), owner, group }),
      ).toBeNull();
      expect(acquireSlowSlot({ dir: inB, owner, group })).toBeNull();
      markSlotWaiter(inA, "a2", group);
      expect(othersWaitingForSlot(inA, "a", Date.now(), group)).toBe(true);
      expect(othersWaitingForSlot(inB, "b", Date.now(), group)).toBe(false);
      a?.release();
      b?.release();
    }
  });

  test("a missing base is made private with the repository's directory, so the pool still takes it", () => {
    const dir = slotFiles("e2e").dir(base, commonA);
    acquireSlowSlot({ dir, owner, group: "e2e" })?.release();
    for (const made of [base, dir]) expect(statSync(made).mode & 0o777).toBe(0o700);
    const pool = createPermitPool({ dir: base, owner, hostSlots: 2, cores: null });
    const lease = pool.acquire(1);
    expect(lease?.grant).toBe(1);
    pool.close();
  });
});
