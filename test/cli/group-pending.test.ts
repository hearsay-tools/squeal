import { afterEach, describe, expect, it } from "vitest";
import { heartbeatSilence, holderText, type SilenceUnread } from "../../src/cli/group-pending.js";
import type { GroupHolder } from "../../src/core/types/daemon.js";
import { squealRepo } from "../harness/helpers.js";
import { closeFakeDaemons, lockStore } from "./fake-daemon.js";

/*
 * Row 011-302 (gh-154): the words for what holds a `run-group` request the
 * deadline passed: the daemon's main thread first, then the holder it
 * reported, each with how long; unknown when nothing is recorded.
 */

const KEYING = { operation: "keying lint checks", heldMs: 107_000 };
/** Row 011-334: the heartbeat not read, with why. */
const BUSY: SilenceUnread = {
  unread:
    "store busy, waited 100 ms: another process holds the store's lock; run the command again once it is released",
};
const LOCK: GroupHolder = {
  kind: "scheduler",
  operation: "applying revision 412",
  heldMs: 48_400,
  step: null,
};

describe("holderText (row 011-302)", () => {
  it.each<[GroupHolder | null | undefined, number | null | SilenceUnread, string]>([
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
    // Row 011-334: a heartbeat not read says so in its place, before what the socket recorded.
    [
      LOCK,
      BUSY,
      `the daemon's heartbeat was not read (${BUSY.unread}); it waits for the scheduler, which has been applying revision 412 for 48 s`,
    ],
    [
      { kind: "unanswered", heldMs: 21_000, step: null },
      BUSY,
      `the daemon's heartbeat was not read (${BUSY.unread}); the daemon's main thread has not read the request for 21 s`,
    ],
    [undefined, BUSY, `the daemon's heartbeat was not read (${BUSY.unread})`],
  ])("%j with silence %j", (holder, silentMs, words) => {
    expect(holderText(holder, silentMs)).toBe(words);
  });
});

describe("heartbeatSilence (row 011-302)", () => {
  afterEach(closeFakeDaemons);

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

  it("is why the store was not read, within its 100 ms bound, while a second connection holds the lock (row 011-334)", () => {
    const r = squealRepo();
    r.daemon("stale", Date.now() - 111_000);
    // An exclusive lock on a WAL store needs every other connection closed.
    r.store.close();
    lockStore(r.repo.commonDir);
    const started = performance.now();
    const silence = heartbeatSilence(r.root);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(silence).toEqual({
      unread: expect.stringMatching(
        /^store busy, waited \d+ ms: another process holds the store's lock; run the command again once it is released$/,
      ),
    });
  });
});
