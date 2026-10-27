import * as fs from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  type LockAttempt,
  STALE_LOCK_MS,
} from "../../../../src/harness/codex/runtime-update/lock.js";
import { lockFile } from "../../../../src/harness/codex/runtime-update/paths.js";
import { deadPid, machine } from "./fixture.js";

vi.mock("node:fs", async (original) => ({ ...(await original<typeof fs>()) }));
afterEach(() => vi.restoreAllMocks());

describe("updater exclusion through stale recovery (002-37)", () => {
  it("never displaces a live owner after observing stale content", async () => {
    const { data } = machine();
    const path = lockFile(data);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify({ schema: 1, pid: deadPid(), startedAt: 0, token: "X" }));
    const read = fs.readFileSync;
    const rename = fs.renameSync;
    let b: Promise<LockAttempt> | undefined;
    let c: Promise<LockAttempt> | undefined;
    let observed = false;
    vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof read>) => {
      const value = read(...args);
      if (args[0] === path && !observed) {
        observed = true;
        // A has read stale X. B recovers X and enters before A acts on its read.
        fs.rmSync(path);
        b = acquireLock(data);
      }
      return value;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      // A has displaced B. C can enter before A checks the displaced content.
      if (from === path) c = acquireLock(data);
    });
    const a = await acquireLock(data);
    const attempts = [a, await (b ?? acquireLock(data)), await (c ?? acquireLock(data))];
    try {
      expect(attempts.filter((attempt) => "lock" in attempt)).toHaveLength(1);
    } finally {
      for (const attempt of attempts) if ("lock" in attempt) attempt.lock.release();
    }
  });

  it("keeps a live owner even when its timestamp is old or its record is corrupt", async () => {
    const { data } = machine();
    const owner = await acquireLock(data, { now: () => 0 });
    expect(owner).toHaveProperty("lock");
    if (!("lock" in owner)) return;
    try {
      const old = await acquireLock(data, { now: () => STALE_LOCK_MS + 1 });
      if ("lock" in old) old.lock.release();
      expect(old).toHaveProperty("busy");
      fs.writeFileSync(lockFile(data), "unreadable owner record");
      const corrupt = await acquireLock(data);
      if ("lock" in corrupt) corrupt.lock.release();
      expect(corrupt).toHaveProperty("busy");
    } finally {
      owner.lock.release();
    }
  });
});
