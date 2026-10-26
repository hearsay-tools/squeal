import { renameSync } from "node:fs";
import { getPriority } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  claimFullCheck,
  FULL_CHECK_EVERY_MS,
  type FullCheck,
  runFullCheck,
  startFullCheck,
} from "../../src/core/daemon/full-check.js";
import { TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { storeCondemned, storeFileOf } from "../../src/core/daemon/store-file.js";
import { META_FULL_CHECK, readStoreMark, storePaths } from "../../src/core/store/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { fakeCommonDir, open, seedIndexFault } from "../store/helpers.js";
import { checkContext, heldCheck, until } from "./full-check-helpers.js";

/*
 * Row 011-226 (spec 011, store failures as amended 2026-10-25): the full
 * `integrity_check` runs after a daemon serves, at most once per store in
 * 24 h, claimed through a meta row, in a process of its own at nice 10. A
 * fault marks the store, and every daemon's heartbeat reads the mark.
 */

const T = 1_800_000_000_000;

const FAULT = { problem: "row 1 missing from index fault_a" };

/**
 * `runFullCheck` with Node's binary at `missing`, as when the install the
 * daemon runs from was removed while it serves: the spawn fails with ENOENT.
 * Each check it starts is pushed to `started`.
 */
function unspawnable(missing: string, started: FullCheck[]): (database: AbsolutePath) => FullCheck {
  return (database) => {
    const execPath = process.execPath;
    process.execPath = missing;
    try {
      const check = runFullCheck(database);
      started.push(check);
      return check;
    } finally {
      process.execPath = execPath;
    }
  };
}

describe("the full check's claim (row 011-226)", () => {
  it("goes to one of two connections on one store, and again after 24 h", () => {
    const commonDir = fakeCommonDir();
    const a = open(commonDir);
    const b = open(commonDir);

    expect(claimFullCheck(a, T)).toEqual({ at: T, before: null });
    expect(claimFullCheck(b, T + 1)).toBeNull();
    expect(claimFullCheck(a, T + FULL_CHECK_EVERY_MS - 1)).toBeNull();
    expect(b.meta.get(META_FULL_CHECK)).toBe(String(T));

    expect(claimFullCheck(b, T + FULL_CHECK_EVERY_MS)).toEqual({
      at: T + FULL_CHECK_EVERY_MS,
      before: String(T),
    });
    // A clock set back finds the last start ahead of it: no claim is held.
    expect(claimFullCheck(a, T)).toEqual({ at: T, before: String(T + FULL_CHECK_EVERY_MS) });
  });

  it("is given back when the check is stopped before it ended, and kept once it ended", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const first = heldCheck();
    const one = checkContext(store, commonDir, [first], () => T);
    const stop = startFullCheck(one.context);
    await until(() => one.runs() === 1);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    await stop();
    expect(first.stopped).toBe(true);
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();

    const second = heldCheck();
    const two = checkContext(store, commonDir, [second], () => T);
    const stopSecond = startFullCheck(two.context);
    await until(() => two.runs() === 1);
    second.end({ ok: true });
    await until(() => two.logs.includes("full integrity check: ok"));
    await stopSecond();
    expect(second.stopped).toBe(true);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
  });

  it("is given back when the check could not run", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    const one = checkContext(store, commonDir, [check], () => T);
    startFullCheck(one.context);
    await until(() => one.runs() === 1);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    check.end({ unrun: "unable to open database file" });
    await until(() => store.meta.get(META_FULL_CHECK) === null);
    expect(readStoreMark(commonDir)).toBeNull();
  });

  it("runs no check while another daemon holds the day's claim", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    claimFullCheck(store, T - 1_000);
    const one = checkContext(store, commonDir, [heldCheck()], () => T);
    const stop = startFullCheck(one.context);
    await sleep(50);
    await stop();
    expect(one.runs()).toBe(0);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T - 1_000));
  });
});

describe("the full check's process (row 011-226)", () => {
  it("runs at nice 10 in its own process while the caller's thread goes on, and finds an index fault", async () => {
    const commonDir = fakeCommonDir();
    seedIndexFault(commonDir);
    const check = runFullCheck(storePaths(commonDir).database);
    const pid = check.pid;
    if (pid === undefined) throw new Error("no check process");
    // Held, so the check is still running while this thread's timers fire.
    process.kill(pid, "SIGSTOP");
    try {
      expect(pid).not.toBe(process.pid);
      expect(getPriority(pid)).toBe(TEST_NICE);
      const pending = await Promise.race([check.done.then(() => "ended"), sleep(50, "pending")]);
      expect(pending).toBe("pending");
    } finally {
      process.kill(pid, "SIGCONT");
    }
    const outcome = await check.done;
    expect(outcome).toEqual({
      problem: expect.stringContaining("row 1 missing from index fault_a"),
    });
  });

  it("passes a sound store", async () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");
    expect(await runFullCheck(storePaths(commonDir).database).done).toEqual({ ok: true });
  });

  it("reports a check it could not run as unrun, not as a fault", async () => {
    const outcome = await runFullCheck(`${fakeCommonDir()}/squeal/missing.sqlite`).done;
    expect(outcome).toEqual({ unrun: expect.stringContaining("unable to open") });
  });
});

describe("the full check's error paths (row 011-229)", () => {
  it("logs a start that throws, and its stop gives the claim back", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const one = checkContext(store, commonDir, [], () => T);
    const stop = startFullCheck({
      ...one.context,
      run: () => {
        throw new Error("spawn E2BIG");
      },
    });
    await until(() => one.logs.length > 0);
    expect(one.logs).toEqual(["full integrity check failed: Error: spawn E2BIG"]);
    await stop();
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();
  });

  it("reports a process that cannot spawn as unrun, gives the claim back, and a later start claims", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const missing = join(commonDir, "no-node");
    const started: FullCheck[] = [];
    const first = checkContext(store, commonDir, [], () => T);
    const stop = startFullCheck({ ...first.context, run: unspawnable(missing, started) });
    await until(() => started.length === 1);
    const [check] = started;
    expect(check?.pid).toBeUndefined();
    expect(await check?.done).toEqual({ unrun: `spawn ${missing} ENOENT` });
    await until(() => store.meta.get(META_FULL_CHECK) === null);
    expect(first.logs).toEqual([`full integrity check did not run: spawn ${missing} ENOENT`]);

    const next = checkContext(store, commonDir, [heldCheck()], () => T + 1);
    const stopNext = startFullCheck(next.context);
    await until(() => next.runs() === 1);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T + 1));
    await stopNext();
    await stop();
  });
});

describe("a failed full check marks the store (row 011-226)", () => {
  it("writes the mark and one note, and the heartbeat's reason names the full check", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    const { notes, context: ctx, runs } = checkContext(store, commonDir, [check], () => T + 5);
    startFullCheck(ctx);
    await until(() => runs() === 1);
    expect(storeCondemned(commonDir)).toBeNull();

    check.end(FAULT);
    await until(() => notes.length > 0);
    expect(readStoreMark(commonDir)).toEqual({
      at: T + 5,
      problem: "row 1 missing from index fault_a",
    });
    expect(notes).toEqual([
      expect.stringContaining("the full integrity check of the store found a fault"),
    ]);
    expect(storeCondemned(commonDir)).toMatch(
      /^daemon stopped: the full integrity check of the store found a fault \(row 1 missing/,
    );
  });

  it("stops a daemon whose store file was moved aside, which takes the mark with it", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const opened = storeFileOf(commonDir);
    expect(storeCondemned(commonDir, opened)).toBeNull();
    const { database } = storePaths(commonDir);
    renameSync(database, `${database}.corrupt-1`);
    expect(storeCondemned(commonDir, opened)).toMatch(/store file it opened was moved aside/);
    open(commonDir);
    expect(storeCondemned(commonDir, opened)).toMatch(/store file it opened was moved aside/);
    expect(storeCondemned(commonDir, storeFileOf(commonDir))).toBeNull();
  });
});
