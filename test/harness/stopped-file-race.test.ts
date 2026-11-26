import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { stopCommand } from "../../src/cli/stop.js";
import { stopTree } from "../../src/cli/stopped-mark.js";
import { stopHolds } from "../../src/core/delivery/stopped.js";
import { writeStopFile } from "../../src/core/presence/lock-events.js";
import { readStopFile, stopLockFor, stopMarkFor } from "../../src/core/presence/marks.js";
import { readStop, type StopMark } from "../../src/core/presence/stored.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { squealRepo } from "./helpers.js";
import { gitRepo } from "./stopped-repo.js";

/*
 * Review 0.1.639 B1 (row 021-39): every change of the stop mark beside the
 * lock file is made under the mark's own lock (`withStopFileLock`), so a
 * boundary's read, comparison and change are one step. A second process
 * stands in for the other side: it takes the same lock, says so, holds it
 * for `holdMs`, makes its change and releases it, as `squeal stop`, `squeal
 * start` or a boundary does. Before the lock a boundary that read the mark
 * before the other process changed it removed or overwrote that change.
 */

const HOLDER = `
import { DatabaseSync } from "node:sqlite";
import { renameSync, rmSync, writeFileSync } from "node:fs";
const [lock, mark, action, json, holdMs] = process.argv.slice(1);
const db = new DatabaseSync(lock);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("PRAGMA locking_mode = EXCLUSIVE");
db.exec("BEGIN EXCLUSIVE");
process.stdout.write("held\\n");
setTimeout(() => {
  if (action === "write") {
    writeFileSync(mark + ".holder", json);
    renameSync(mark + ".holder", mark);
  } else if (action === "remove") rmSync(mark, { force: true });
  db.exec("ROLLBACK");
  db.close();
}, Number(holdMs));
`;

const children: ChildProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A second process that holds the mark's lock for `holdMs`, then writes `mark` or removes the file. */
async function holder(
  lockFile: AbsolutePath,
  change: { write: StopMark } | "remove" | "none",
  holdMs: number,
): Promise<{ readonly done: Promise<unknown> }> {
  const action = typeof change === "string" ? change : "write";
  const json = typeof change === "string" ? "" : JSON.stringify(change.write);
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      HOLDER,
      stopLockFor(lockFile),
      stopMarkFor(lockFile),
      action,
      json,
      String(holdMs),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  children.push(child);
  const exited = once(child, "exit");
  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`holder exited ${code} before holding`)));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
  });
  // Wrapped: an async function's returned promise would be awaited with it.
  return { done: exited };
}

function repo() {
  const r = squealRepo(gitRepo(cleanups));
  const root = r.root as AbsolutePath;
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId);
  const holds = () =>
    stopHolds(r.store, { id: r.worktreeId, root }, readStop(r.store, r.worktreeId));
  return { r, root, lockFile, holds };
}

const AT = 1_000 as EpochMs;
const NEWER: StopMark = { at: 2_000 as EpochMs, tree: "a newer print", untilStart: true };

describe("a boundary's change of the stop mark file under its lock (review 0.1.639 B1)", {
  timeout: 30_000,
}, () => {
  it("(a) holds and keeps an `untilStart` stop that lands after the tree print, before the boundary's lock", async () => {
    const { root, lockFile, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: await stopTree(root) });
    writeFileSync(join(root, "a.txt"), "edited\n");
    // The stop takes the lock first and writes once the boundary waits for it.
    const { done } = await holder(lockFile, { write: NEWER }, 600);

    expect(await holds()).toBe(true);

    await done;
    expect(readStopFile(lockFile)).toEqual(NEWER);
  });

  it("(b) a `squeal stop --until-start` waits while a boundary holds the lock, and its mark survives", async () => {
    const { root, lockFile } = repo();
    writeStopFile(lockFile, { at: AT, tree: "an older print" });
    // The boundary's clear: under the lock, then removed.
    const { done } = await holder(lockFile, "remove", 600);
    let stderr = "";
    const io: CliIo = {
      env: {},
      cwd: root,
      now: () => 5_000,
      stdout: () => undefined,
      stderr: (text) => {
        stderr += text;
      },
    };
    const started = Date.now();

    const code = await stopCommand(["--until-start"], io);

    await done;
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(readStopFile(lockFile)).toMatchObject({ at: 5_000, untilStart: true });
  });

  it("(c) a null tree's fill overwrites no newer stop", async () => {
    const { lockFile, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: null });
    const { done } = await holder(lockFile, { write: NEWER }, 600);

    expect(await holds()).toBe(true);

    await done;
    expect(readStopFile(lockFile)).toEqual(NEWER);
  });

  it("(c) a null tree's fill restores no mark a `squeal start` removed", async () => {
    const { r, lockFile, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: null });
    const { done } = await holder(lockFile, "remove", 600);

    expect(await holds()).toBe(false);

    await done;
    expect(readStopFile(lockFile)).toBeNull();
    expect(readStop(r.store, r.worktreeId)).toBeNull();
  });

  it("fails closed: holds while the lock cannot be taken", async () => {
    const { root, lockFile, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: await stopTree(root) });
    writeFileSync(join(root, "a.txt"), "edited\n");
    await holder(lockFile, "none", 10_000);

    expect(await holds()).toBe(true);
    expect(readStopFile(lockFile)).not.toBeNull();
  });
});
