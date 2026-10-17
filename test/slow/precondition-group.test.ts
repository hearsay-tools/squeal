import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { statOf } from "../../src/core/daemon/terminate.js";
import { checkPrecondition, type PreconditionRule } from "../../src/core/slow/precondition.js";

/*
 * Review wave-8.1 S1 (spec 004 D7 as amended 2026-10-17): a precondition
 * command runs in its own process group, killed whole at its timeout, at
 * the daemon's close and once it exits, so a process it spawned does not
 * outlive the check. Liveness is read from `/proc`: a zombie or an exiting
 * process counts as gone (`statOf`).
 */

const NODE = process.execPath;
const dirs: string[] = [];
const spawned: number[] = [];
afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone, as it should be.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A wrapper that spawns a node child running an interval, writes the
 * child's pid to `child.pid`, then hangs (`hang`) or exits 0.
 */
function wrapper(root: string, hang: boolean): PreconditionRule {
  const pidFile = JSON.stringify(join(root, "child.pid"));
  const script = [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
    `fs.writeFileSync(${pidFile}, String(child.pid));`,
    hang ? "setInterval(() => {}, 1000);" : "setTimeout(() => process.exit(0), 100);",
  ].join("\n");
  return {
    precondition: { command: [NODE, "-e", script], timeoutMs: 1_000 },
    source: "slow.precondition",
  };
}

function worktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-65-group-"));
  dirs.push(dir);
  return dir;
}

function childOf(root: string): number {
  const pid = Number(readFileSync(join(root, "child.pid"), "utf8"));
  spawned.push(pid);
  return pid;
}

/** Whether `pid` still runs within `ms` of now. */
async function outlives(pid: number, ms = 2_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (statOf(pid) === null) return false;
    await delay(25);
  }
  return true;
}

describe("a precondition command's process group (review wave-8.1 S1)", {
  timeout: 30_000,
}, () => {
  it("kills what the command spawned when it times out", async () => {
    const root = worktree();
    expect(await checkPrecondition(root, wrapper(root, true))).toMatch(
      /did not exit within 1000 ms \(slow\.precondition\.command\)$/,
    );
    expect(await outlives(childOf(root))).toBe(false);
  });

  it("kills what the command spawned when the daemon closes during it", async () => {
    const root = worktree();
    const closing = new AbortController();
    const check = checkPrecondition(root, wrapper(root, true), { signal: closing.signal });
    while (!existsSync(join(root, "child.pid"))) await delay(25);
    closing.abort();
    expect(await check).toMatch(/was stopped as the daemon closed/);
    expect(await outlives(childOf(root))).toBe(false);
  });

  it("kills what a met command left running when it exits", async () => {
    const root = worktree();
    expect(await checkPrecondition(root, wrapper(root, false))).toBeNull();
    expect(await outlives(childOf(root))).toBe(false);
  });
});
