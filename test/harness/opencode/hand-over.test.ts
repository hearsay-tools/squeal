import { describe, expect, it } from "vitest";
import { PreparedReports } from "../../../src/core/delivery/prepared.js";
import { handOver } from "../../../src/harness/opencode/bridge.js";
import { VERDICT_SIGNAL } from "../../../src/harness/opencode/bridge-verdict.js";
import { HandOff, type OutputStream } from "../../../src/harness/shared/hand-off.js";

/*
 * Review `reviews/0.1.386.md` B1 (row 011-288, 011 C8 as amended
 * 2026-10-31): a held answer whose write fails is abandoned, even when a
 * stray verdict signal arrived while the write was stalled. The plugin never
 * read the text, so the report stays owed.
 */

/** A hand-off holding one report, and what happened to it. */
function held() {
  const ends: string[] = [];
  const reports = new PreparedReports();
  let open = true;
  reports.add({
    get open() {
      return open;
    },
    commit: () => {
      open = false;
      ends.push("commit");
    },
    abandon: () => {
      open = false;
      ends.push("abandon");
    },
  });
  const handOff = new HandOff();
  handOff.take(reports, () => {});
  return { handOff, ends };
}

/** A stream whose write never completes. */
const stalled: OutputStream = { write: () => true };
/** A stream whose write fails. */
const failing: OutputStream = {
  write: (_text, callback) => {
    setImmediate(() => callback(new Error("EPIPE")));
    return false;
  },
};
/** A stream whose write completes. */
const open: OutputStream = {
  write: (_text, callback) => {
    setImmediate(() => callback(null));
    return true;
  },
};

describe("a held answer's hand-over (review 0.1.386 B1)", () => {
  it("abandons a stalled write's report though a stray signal came first", async () => {
    const { handOff, ends } = held();
    const done = handOver(handOff, { by: Date.now() + 300 }, "{}\n", stalled);
    setTimeout(() => process.emit(VERDICT_SIGNAL), 20);
    await done;
    expect(ends).toEqual(["abandon"]);
  });

  it("abandons a failed write's report though a signal came first", async () => {
    const { handOff, ends } = held();
    process.nextTick(() => process.emit(VERDICT_SIGNAL));
    await handOver(handOff, { by: Date.now() + 2_000 }, "{}\n", failing);
    expect(ends).toEqual(["abandon"]);
  });

  it("commits a written answer at the plugin's signal", async () => {
    const { handOff, ends } = held();
    const done = handOver(handOff, { by: Date.now() + 2_000 }, "{}\n", open);
    setTimeout(() => process.emit(VERDICT_SIGNAL), 20);
    await done;
    expect(ends).toEqual(["commit"]);
  });

  it("abandons a written answer with no signal by the deadline", async () => {
    const { handOff, ends } = held();
    await handOver(handOff, { by: Date.now() + 100 }, "{}\n", open);
    expect(ends).toEqual(["abandon"]);
  });
});
