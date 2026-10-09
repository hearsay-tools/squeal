import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { currentUid, userTmpDir } from "../../src/core/daemon/paths.js";
import {
  acquireSlowSlot,
  clearSlotWaiter,
  markSlotWaiter,
  othersWaitingForSlot,
  SLOT_WAITER_FRESH_MS,
  slowSlotDir,
} from "../../src/core/slow/index.js";

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const slotModule = fileURLToPath(new URL("../../src/core/slow/slot.ts", import.meta.url));

/**
 * A plain Node process that takes the slot (retrying every 10 ms), prints
 * "took", releases it on a "release" line on stdin, prints "released" and
 * exits.
 */
const holderScript = `
import { createInterface } from "node:readline";
const { acquireSlowSlot } = await import(${JSON.stringify(slotModule)});
const [dir, worktreeId] = process.argv.slice(1);
let slot = null;
while ((slot = acquireSlowSlot({ dir, owner: { pid: process.pid, worktreeId } })) === null) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
console.log("took");
for await (const line of createInterface({ input: process.stdin })) {
  if (line === "release") break;
}
slot.release();
console.log("released");
`;

interface Holder {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly waitFor: (text: string) => Promise<void>;
  readonly closed: Promise<void>;
}

const holders: Holder[] = [];

function spawnHolder(dir: string, worktreeId: string): Holder {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      register,
      "--input-type=module",
      "--eval",
      holderScript,
      dir,
      worktreeId,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  const holder: Holder = {
    child,
    output: () => stdout,
    closed,
    waitFor: async (text) => {
      const deadline = Date.now() + 30_000;
      while (!stdout.includes(text)) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`holder exited before "${text}": ${stderr}`);
        }
        if (Date.now() > deadline) throw new Error(`no "${text}" within 30 s: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
  holders.push(holder);
  return holder;
}

let root: string;
let dir: string;
const owner = { pid: process.pid, worktreeId: "test" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-slot-test-"));
  dir = join(root, "squeal-uid");
});

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    if (holder.child.exitCode === null && holder.child.signalCode === null) {
      holder.child.kill("SIGKILL");
    }
    await holder.closed;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("acquireSlowSlot: one slow file at a time per user (spec 004 D2)", () => {
  test("a second taker in the same process gets null until the first releases", () => {
    const first = acquireSlowSlot({ dir, owner });
    expect(first).not.toBeNull();
    expect(acquireSlowSlot({ dir, owner })).toBeNull();
    first?.release();
    first?.release();
    const second = acquireSlowSlot({ dir, owner });
    expect(second).not.toBeNull();
    second?.release();
  });

  test("two processes take the slot in turns", { timeout: 60_000 }, async () => {
    const a = spawnHolder(dir, "a");
    const b = spawnHolder(dir, "b");
    await Promise.race([a.waitFor("took"), b.waitFor("took")]);
    const [first, second] = a.output().includes("took") ? [a, b] : [b, a];
    // The other keeps retrying meanwhile and must not get it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(second.output()).not.toContain("took");
    expect(acquireSlowSlot({ dir, owner })).toBeNull();

    first.child.stdin?.end("release\n");
    await first.waitFor("released");
    await second.waitFor("took");
    expect(acquireSlowSlot({ dir, owner })).toBeNull();

    second.child.stdin?.end("release\n");
    await second.waitFor("released");
    await Promise.all([first.closed, second.closed]);
    const mine = acquireSlowSlot({ dir, owner });
    expect(mine).not.toBeNull();
    mine?.release();
  });

  test("a holder killed with SIGKILL leaves a slot the next taker gets", {
    timeout: 60_000,
  }, async () => {
    const holder = spawnHolder(dir, "doomed");
    await holder.waitFor("took");
    expect(acquireSlowSlot({ dir, owner })).toBeNull();
    holder.child.kill("SIGKILL");
    await holder.closed;
    const next = acquireSlowSlot({ dir, owner });
    expect(next).not.toBeNull();
    next?.release();
  });

  test("an aborted signal releases the slot; an already aborted one takes nothing", () => {
    const controller = new AbortController();
    const slot = acquireSlowSlot({ dir, owner, signal: controller.signal });
    expect(slot).not.toBeNull();
    expect(acquireSlowSlot({ dir, owner })).toBeNull();
    controller.abort();
    expect(acquireSlowSlot({ dir, owner, signal: controller.signal })).toBeNull();
    const next = acquireSlowSlot({ dir, owner });
    expect(next).not.toBeNull();
    next?.release();
    slot?.release();
  });
});

describe("the slot directory is checked as spec 001 D10 checks the per-user directory", () => {
  test("a missing directory is created with mode 0700", () => {
    acquireSlowSlot({ dir, owner })?.release();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("a directory others can enter is refused", () => {
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(() => acquireSlowSlot({ dir, owner })).toThrow(/mode 755, not 700/);
  });

  test("a directory owned by another uid is refused", () => {
    mkdirSync(dir, { mode: 0o700 });
    expect(() => acquireSlowSlot({ dir, owner, uid: currentUid() + 1 })).toThrow(/is owned by uid/);
  });
});

describe("the slot directory follows the daemon's XDG_RUNTIME_DIR (spec 004 D2, 004-16)", () => {
  test("squeal in an absolute XDG_RUNTIME_DIR, else the per-user /tmp directory", () => {
    expect(slowSlotDir({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000/squeal");
    expect(slowSlotDir({})).toBe(userTmpDir());
    expect(slowSlotDir({ XDG_RUNTIME_DIR: "" })).toBe(userTmpDir());
    expect(slowSlotDir({ XDG_RUNTIME_DIR: "relative/run" })).toBe(userTmpDir());
  });

  test("a daemon under another runtime directory takes its own slot while the outer one is held", {
    timeout: 60_000,
  }, async () => {
    const outer = join(root, "outer-run");
    const inner = join(root, "inner-run");
    mkdirSync(outer, { mode: 0o700 });
    mkdirSync(inner, { mode: 0o700 });
    const holder = spawnHolder(slowSlotDir({ XDG_RUNTIME_DIR: outer }), "outer");
    await holder.waitFor("took");
    expect(acquireSlowSlot({ dir: slowSlotDir({ XDG_RUNTIME_DIR: outer }), owner })).toBeNull();
    const mine = acquireSlowSlot({ dir: slowSlotDir({ XDG_RUNTIME_DIR: inner }), owner });
    expect(mine).not.toBeNull();
    expect(statSync(join(inner, "squeal")).mode & 0o777).toBe(0o700);
    mine?.release();
    holder.child.stdin?.end("release\n");
    await holder.waitFor("released");
  });
});

describe("a waiter's mark hands the slot over between files (spec 004 D2, lessons defect 2)", () => {
  test("another worktree's fresh mark counts, the worktree's own never does", () => {
    mkdirSync(dir, { mode: 0o700 });
    expect(othersWaitingForSlot(dir, "a")).toBe(false);
    markSlotWaiter(dir, "a");
    expect(othersWaitingForSlot(dir, "a")).toBe(false);
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
    clearSlotWaiter(dir, "a");
    clearSlotWaiter(dir, "a");
    expect(othersWaitingForSlot(dir, "b")).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a mark not refreshed within SLOT_WAITER_FRESH_MS is ignored", () => {
    mkdirSync(dir, { mode: 0o700 });
    markSlotWaiter(dir, "a");
    const later = Date.now() + SLOT_WAITER_FRESH_MS + 1_000;
    expect(othersWaitingForSlot(dir, "b", later)).toBe(false);
    // A retry refreshes it.
    markSlotWaiter(dir, "a");
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
  });

  test("a missing directory has no waiters, and marks leave the lock alone", () => {
    expect(othersWaitingForSlot(dir, "b")).toBe(false);
    const slot = acquireSlowSlot({ dir, owner });
    markSlotWaiter(dir, "a");
    expect(acquireSlowSlot({ dir, owner })).toBeNull();
    slot?.release();
    expect(othersWaitingForSlot(dir, "b")).toBe(true);
  });
});
