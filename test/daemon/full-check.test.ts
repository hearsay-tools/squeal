import { renameSync } from "node:fs";
import { getPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  claimFullCheck,
  FULL_CHECK_EVERY_MS,
  type FullCheck,
  type FullCheckOutcome,
  runFullCheck,
  startFullCheck,
  storeCondemned,
  storeFileOf,
} from "../../src/core/daemon/full-check.js";
import { TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { META_FULL_CHECK, readStoreMark, storePaths } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open, seedIndexFault } from "../store/helpers.js";

/*
 * Row 011-226 (spec 011, store failures as amended 2026-10-25): the full
 * `integrity_check` runs after a daemon serves, at most once per store in
 * 24 h, claimed through a meta row, in a process of its own at nice 10. A
 * fault marks the store, and every daemon's heartbeat reads the mark.
 */

const T = 1_800_000_000_000;

const FAULT = { problem: "row 1 missing from index fault_a" };

/** A check that ends only when the test says so. */
function heldCheck(): FullCheck & { end: (outcome: FullCheckOutcome) => void; stopped: boolean } {
  let end: (outcome: FullCheckOutcome) => void = () => {};
  const done = new Promise<FullCheckOutcome>((resolve) => {
    end = resolve;
  });
  const check = {
    pid: undefined,
    done,
    end: (outcome: FullCheckOutcome) => end(outcome),
    stopped: false,
    stop: () => {
      check.stopped = true;
    },
  };
  return check;
}

function context(store: Store, commonDir: string, run: () => FullCheck, now = () => T) {
  const notes: string[] = [];
  return {
    notes,
    context: {
      store,
      commonDir,
      now,
      note: (text: string) => notes.push(text),
      log: () => {},
      run,
    },
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
    const stop = startFullCheck(context(store, commonDir, () => first).context);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    stop();
    expect(first.stopped).toBe(true);
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();

    const second = heldCheck();
    const stopSecond = startFullCheck(context(store, commonDir, () => second).context);
    second.end({ ok: true });
    await second.done;
    await sleep(0);
    stopSecond();
    expect(second.stopped).toBe(false);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
  });

  it("is given back when the check could not run", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    startFullCheck(context(store, commonDir, () => check).context);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    check.end({ unrun: "unable to open database file" });
    await check.done;
    await sleep(0);
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();
    expect(readStoreMark(commonDir)).toBeNull();
  });

  it("runs no check while another daemon holds the day's claim", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    claimFullCheck(store, T - 1_000);
    let runs = 0;
    startFullCheck(
      context(store, commonDir, () => {
        runs++;
        return heldCheck();
      }).context,
    );
    expect(runs).toBe(0);
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

describe("a failed full check marks the store (row 011-226)", () => {
  it("writes the mark and one note, and the heartbeat's reason names the full check", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    const { notes, context: ctx } = context(
      store,
      commonDir,
      () => check,
      () => T + 5,
    );
    startFullCheck(ctx);
    expect(storeCondemned(commonDir)).toBeNull();

    check.end(FAULT);
    await check.done;
    await sleep(0);
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
