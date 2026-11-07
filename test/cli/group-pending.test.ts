import { describe, expect, it } from "vitest";
import { heartbeatSilence, holderText } from "../../src/cli/group-pending.js";
import type { GroupHolder } from "../../src/core/types/daemon.js";
import { squealRepo } from "../harness/helpers.js";

/*
 * Row 011-302 (gh-154): the words for what holds a `run-group` request the
 * deadline passed: the daemon's main thread first, then the holder it
 * reported, each with how long; unknown when nothing is recorded.
 */

const KEYING = { operation: "keying lint checks", heldMs: 107_000 };
const LOCK: GroupHolder = {
  kind: "scheduler",
  operation: "applying revision 412",
  heldMs: 48_400,
  step: null,
};

describe("holderText (row 011-302)", () => {
  it.each<[GroupHolder | null | undefined, number | null, string]>([
    [LOCK, null, "it waits for the scheduler, which has been applying revision 412 for 48 s"],
    [
      { kind: "scheduler", operation: null, heldMs: 3_000, step: null },
      null,
      "it waits for the scheduler, which has been busy for 3 s with work it does not name",
    ],
    [
      { kind: "startup", heldMs: 75_000, step: null },
      null,
      "it waits for the daemon's startup, which has run for 1 min 15 s",
    ],
    [
      { kind: "unanswered", heldMs: 21_000, step: null },
      null,
      "the daemon's main thread has not read the request for 21 s",
    ],
    [
      { kind: "unanswered", heldMs: 60_100, step: KEYING },
      null,
      "the daemon's main thread has not read the request for 1 min and has been keying lint checks for 1 min 47 s",
    ],
    [
      {
        kind: "startup",
        heldMs: 90_000,
        step: { operation: "keying lint checks", heldMs: 30_000 },
      },
      null,
      "the daemon's main thread has been keying lint checks for 30 s; it waits for the daemon's startup, which has run for 1 min 30 s",
    ],
    // gh-154: a late heartbeat leads; the lock's holder stays the second detail.
    [
      LOCK,
      111_000,
      "the daemon's main thread has sent no heartbeat for 1 min 51 s; it waits for the scheduler, which has been applying revision 412 for 48 s",
    ],
    [
      { kind: "unanswered", heldMs: 60_000, step: KEYING },
      111_000,
      "the daemon's main thread has sent no heartbeat for 1 min 51 s, has not read the request for 1 min and has been keying lint checks for 1 min 47 s",
    ],
    [undefined, 111_000, "the daemon's main thread has sent no heartbeat for 1 min 51 s"],
    [null, 21_000, "the daemon's main thread has sent no heartbeat for 21 s"],
    [{ kind: "unknown", step: null }, null, "what holds it is unknown"],
    [null, null, "what holds it is unknown"],
    [undefined, null, "this daemon does not say what holds it"],
  ])("%j with silence %j", (holder, silentMs, words) => {
    expect(holderText(holder, silentMs)).toBe(words);
  });
});

describe("heartbeatSilence (row 011-302)", () => {
  it("is the heartbeat's age once past its grace, null while on time or with no daemon", () => {
    const r = squealRepo();
    const now = Date.now();
    expect(heartbeatSilence(r.root, now)).toBeNull();
    // Interval 5 s, grace two intervals: 10 s old is on time, 10.001 s is late.
    r.daemon("stale", now - 10_000);
    expect(heartbeatSilence(r.root, now)).toBeNull();
    expect(heartbeatSilence(r.root, now + 1)).toBe(10_001);
    r.daemon("alive");
    expect(heartbeatSilence(r.root, Date.now())).toBeNull();
  });
});
