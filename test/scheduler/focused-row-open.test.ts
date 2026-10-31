import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  FOCUSED_FILES,
  type FocusedRun,
  readFocused,
  writeFocused,
} from "../../src/core/scheduler/focused-row.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import type { CheckKey, EpochMs, TestFileRef } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-283 (011-273 option B, finding F4; gh-123 in part): the focused
 * row keeps every file an open named wait selected, so a wait over more
 * than `FOCUSED_FILES` files keeps each outcome; the cap counts only the
 * files no open wait selected. Probe P4 lost `rows-01` to `rows-04` of 24.
 */

const ref = (i: number): TestFileRef => ({
  project: "",
  path: `test/rows-${String(i).padStart(2, "0")}.test.ts`,
});
const run = (i: number, endedAt: number): FocusedRun => ({
  testFile: ref(i),
  key: `k${i}` as CheckKey,
  revision: 1 as FocusedRun["revision"],
  texts: [" U2 "],
  runId: `r${i}`,
  logDir: `/tmp/r${i}`,
  startedAt: (endedAt - 1) as EpochMs,
  endedAt: endedAt as EpochMs,
  end: "completed",
  reason: null,
  collected: 7,
  matched: 1,
  checks: [],
  more: 0,
  outcomes: { pass: 1, fail: 0, skip: 0 },
});
const kept = (store: ReturnType<typeof open>) =>
  readFocused(store, "w").map((r) => Number(r.testFile.path.slice(10, 12)));
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A wait over files 1 to 24, open until 10,000 on the store's clock, as the daemon publishes it. */
function waitOver24() {
  const store = open(fakeCommonDir());
  const files = range(1, 24).map((i) => testFileId(ref(i)));
  publishPromotions(store, "w", [{ files, until: 10_000 as EpochMs }], 1_000 as EpochMs);
  return store;
}

describe("the focused row and an open wait (row 011-283, test 5)", () => {
  it("keeps all 24 files of an open wait, and a file of no wait beside them", () => {
    const store = waitOver24();
    for (const i of range(1, 24)) writeFocused(store, "w", [run(i, 2_000 + i)]);
    expect(kept(store)).toEqual(range(1, 24));
    writeFocused(store, "w", [run(30, 3_000)]);
    expect(kept(store)).toEqual([...range(1, 24), 30]);
  });

  it("the cap counts only the files no open wait selected, the oldest dropped first", () => {
    const store = waitOver24();
    for (const i of range(31, 31 + FOCUSED_FILES)) writeFocused(store, "w", [run(i, 2_000)]);
    writeFocused(store, "w", [run(1, 2_500)]);
    // 21 files of no wait: the oldest, 31, goes; the wait's file stays.
    expect(kept(store)).toEqual([...range(32, 31 + FOCUSED_FILES), 1]);
  });

  it("with no wait open, the row keeps 20, the oldest dropped first", () => {
    const store = waitOver24();
    for (const i of range(1, 24)) writeFocused(store, "w", [run(i, 10_000 + i)]);
    expect(kept(store)).toEqual(range(5, 24));
  });
});
