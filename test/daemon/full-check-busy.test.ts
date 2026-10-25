import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { startFullCheck } from "../../src/core/daemon/full-check.js";
import { META_FULL_CHECK } from "../../src/core/store/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { checkContext, heldCheck, holdWriter, until } from "./full-check-helpers.js";

/*
 * Review 0.1.329, B1 and S1 (row 011-226): the full check's claim and its
 * return are C8's busy writes. While another connection holds the store's
 * write lock, each try waits at most `BUSY_SLICE_MS` and the main thread runs
 * between tries; a claim given back after a stop or an unrun check is
 * written once the lock is free, so the next start claims and runs the check.
 * The test store's own busy timeout is 10 s: a single wait holds the thread
 * that long.
 */

const T = 1_800_000_000_000;

/** How late a zero-delay timer set now fires: the longest the main thread was held. */
function heldFor(): Promise<number> {
  const at = performance.now();
  return sleep(0).then(() => performance.now() - at);
}

describe("the full check's claim on a busy store (review 0.1.329, S1)", () => {
  it("waits in short slices, so the main thread runs, and claims once the writer lets go", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const writer = holdWriter(commonDir);
    const one = checkContext(store, commonDir, [heldCheck()], () => T);

    const held = heldFor();
    const stop = startFullCheck(one.context);
    expect(await held).toBeLessThan(2_000);
    await sleep(600);
    expect(one.runs()).toBe(0);
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();

    writer.release();
    await until(() => one.runs() === 1);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    await stop();
  });

  it("is never taken by a daemon that stops while it waits", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const writer = holdWriter(commonDir);
    const one = checkContext(store, commonDir, [heldCheck()], () => T);
    const stop = startFullCheck(one.context);
    await sleep(300);
    await stop();
    writer.release();
    await sleep(300);
    expect(one.runs()).toBe(0);
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();
  });
});

describe("the full check's claim given back on a busy store (review 0.1.329, B1)", () => {
  it("after a stop: the return waits for the writer, then the next start claims", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const first = checkContext(store, commonDir, [heldCheck()], () => T);
    const stop = startFullCheck(first.context);
    await until(() => first.runs() === 1);

    const writer = holdWriter(commonDir);
    const held = heldFor();
    const stopping = stop();
    expect(await held).toBeLessThan(2_000);
    expect(await Promise.race([stopping.then(() => "returned"), sleep(600, "waiting")])).toBe(
      "waiting",
    );
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));

    writer.release();
    await stopping;
    expect(store.meta.get(META_FULL_CHECK)).toBeNull();
    expect(first.logs.filter((line) => line.includes("not given back"))).toEqual([]);
    const next = checkContext(store, commonDir, [heldCheck()], () => T + 1);
    const stopNext = startFullCheck(next.context);
    await until(() => next.runs() === 1);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T + 1));
    await stopNext();
  });

  it("after an unrun check: the return waits for the writer, then the next start claims", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    const first = checkContext(store, commonDir, [check], () => T);
    const stop = startFullCheck(first.context);
    await until(() => first.runs() === 1);

    const writer = holdWriter(commonDir);
    const held = heldFor();
    check.end({ unrun: "unable to open database file" });
    expect(await held).toBeLessThan(2_000);
    await sleep(600);
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));

    writer.release();
    await until(() => store.meta.get(META_FULL_CHECK) === null);
    await stop();
    expect(first.logs.filter((line) => line.includes("not given back"))).toEqual([]);
    const next = checkContext(store, commonDir, [heldCheck()], () => T + 1);
    const stopNext = startFullCheck(next.context);
    await until(() => next.runs() === 1);
    await stopNext();
  });

  it("keeps a later claimant's claim: the return compares the row with its own start", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const first = checkContext(store, commonDir, [heldCheck()], () => T);
    const stop = startFullCheck(first.context);
    await until(() => first.runs() === 1);
    // Another daemon's claim replaced it (a day later, or a clock set back).
    store.meta.set(META_FULL_CHECK, String(T + 7));
    await stop();
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T + 7));
  });
});
