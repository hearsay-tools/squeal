import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { startFullCheck } from "../../src/core/daemon/full-check.js";
import { claimFullCheck, META_FULL_CHECK_HOLDER } from "../../src/core/daemon/full-check-claim.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import { META_FULL_CHECK } from "../../src/core/store/open.js";
import type { LeaseProcess } from "../../src/core/types/daemon-writes.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { checkContext, heldCheck, until } from "./full-check-helpers.js";

/*
 * Row 011-375: the full check's claim names the process that holds it while
 * its check runs. A claim left unanswered by a process now gone (a SIGKILLed
 * daemon) is taken over at once; a live holder's claim, one whose holder's
 * life cannot be told, and an answered one stay held for the day.
 */

const T = 1_800_000_000_000;

/** A process surely gone: this one with another start time, or a child that exited. */
function goneProcess(): LeaseProcess {
  const self = leaseProcess();
  if (self.startTime !== null) return { ...self, startTime: self.startTime + 1 };
  const pid = spawnSync(process.execPath, ["-e", ""]).pid;
  return { pid, startTime: null, pidNamespace: null };
}

function holderRow(store: Store): { at: number; process: LeaseProcess } | null {
  const raw = store.meta.get(META_FULL_CHECK_HOLDER);
  return raw === null ? null : (JSON.parse(raw) as { at: number; process: LeaseProcess });
}

describe("the full check's claim and its holder (row 011-375)", () => {
  it("is taken over before the day ends when its holder is gone, and given back to no start", () => {
    const store = open(fakeCommonDir());
    claimFullCheck(store, T, goneProcess());

    const claim = claimFullCheck(store, T + 1_000);
    expect(claim).toEqual({ at: T + 1_000, before: null });
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T + 1_000));
    expect(holderRow(store)).toEqual({ at: T + 1_000, process: leaseProcess() });
    // Its holder, this process, lives: a second taker finds it held.
    expect(claimFullCheck(store, T + 2_000)).toBeNull();
  });

  it("stays held while its holder's life cannot be told, or with no holder row", () => {
    const store = open(fakeCommonDir());
    const elsewhere = { ...goneProcess(), pidNamespace: "pid:[1]", startTime: 1 };
    claimFullCheck(store, T, elsewhere);
    expect(claimFullCheck(store, T + 1_000)).toBeNull();

    // A start with no holder row: answered, or written by a daemon before this row.
    store.meta.delete(META_FULL_CHECK_HOLDER);
    expect(claimFullCheck(store, T + 1_000)).toBeNull();
    // A holder row of an earlier claim names no current one.
    store.meta.set(META_FULL_CHECK_HOLDER, JSON.stringify({ at: T - 1, process: goneProcess() }));
    expect(claimFullCheck(store, T + 1_000)).toBeNull();
    store.meta.set(META_FULL_CHECK_HOLDER, "not json");
    expect(claimFullCheck(store, T + 1_000)).toBeNull();
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
  });

  it("runs the check over a gone holder's claim; the answer keeps the start and drops the holder", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    claimFullCheck(store, T - 60_000, goneProcess());
    const check = heldCheck();
    const one = checkContext(store, commonDir, [check], () => T);
    const stop = startFullCheck(one.context);
    await until(() => one.runs() === 1);
    expect(holderRow(store)?.at).toBe(T);
    check.end({ ok: true });
    await until(() => holderRow(store) === null);
    await stop();
    expect(store.meta.get(META_FULL_CHECK)).toBe(String(T));
    // Answered: no later daemon takes it over within the day.
    expect(claimFullCheck(store, T + 1_000, goneProcess())).toBeNull();
  });

  it("is given back with its holder row when the check could not run", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const check = heldCheck();
    const one = checkContext(store, commonDir, [check], () => T);
    startFullCheck(one.context);
    await until(() => one.runs() === 1);
    expect(holderRow(store)?.at).toBe(T);
    check.end({ unrun: "unable to open database file" });
    await until(() => store.meta.get(META_FULL_CHECK) === null);
    expect(holderRow(store)).toBeNull();
  });
});
