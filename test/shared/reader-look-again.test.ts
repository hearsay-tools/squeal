import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Timer } from "../../src/core/shared/look-again.js";
import type { Policy } from "../../src/core/types/policy.js";
import { publish, readerOf, scratch, shared } from "./reader-kit.js";
import { cloneOf, cloneWith, git, type Scratch } from "./remote.js";

/*
 * Row 018-70 (gh-261, `research/issue-261-ci-import.md` Q2, Q5 option 1):
 * CI publishes a main commit's export about 1 to 2 min after main moves.
 * While the start point's own export is not listed, the reader lists the
 * remote again every `shared.lookAgain.everySeconds`, for up to `forSeconds`,
 * until the start point moves or the reader closes; a timed-out listing is a
 * miss; one note when it gives up. Each listing and fetch is counted by an
 * `uploadpack` that logs its calls.
 */

type LookAgain = Policy["shared"]["lookAgain"];
const MINUTES_10: LookAgain = { everySeconds: 30, forSeconds: 600 };

/** A timer the test fires by hand. */
function handTimer() {
  const set: { ms: number; fire: () => void; live: boolean }[] = [];
  const timer: Timer = (ms, fire) => {
    const entry = { ms, fire, live: true };
    set.push(entry);
    return () => {
      entry.live = false;
    };
  };
  const pending = () => set.filter((t) => t.live).map((t) => t.ms);
  const fire = () => {
    const entry = set.find((t) => t.live);
    if (entry === undefined) throw new Error("no timer pending");
    entry.live = false;
    entry.fire();
  };
  /** The newest timer's callback, cancelled or not. */
  const last = () => {
    const entry = set.at(-1);
    if (entry === undefined) throw new Error("no timer set");
    return entry.fire;
  };
  return { timer, pending, fire, last };
}

/** Makes `dev`'s `origin` count each upload-pack it starts: each listing and each fetch. */
function counted(s: Scratch, dev: string): () => number {
  const log = join(s.dir, "upload-pack.log");
  const wrapper = join(s.dir, "upload-pack.sh");
  writeFileSync(wrapper, `#!/bin/sh\necho x >> '${log}'\nexec git-upload-pack "$@"\n`);
  chmodSync(wrapper, 0o755);
  git(dev, ["config", "remote.origin.uploadpack", wrapper]);
  return () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").length - 1 : 0);
}

/** A new main commit on the CI checkout, pushed and not published: its id. */
function landed(ci: string, text: string): string {
  writeFileSync(join(ci, "n.txt"), `${text}\n`);
  git(ci, ["commit", "-qam", text]);
  git(ci, ["push", "-q", "origin", "main"]);
  return git(ci, ["rev-parse", "HEAD"]);
}

/**
 * A developer whose reader imported the export of `c0`, then pulled `c1`,
 * whose export is not published yet, and looked once.
 */
async function movedBeforePublish(lookAgain: LookAgain) {
  const s = scratch();
  const ci = cloneWith(s, "ci", 1);
  const [c0] = ci.commits as [string];
  await publish(ci.root, c0);
  const dev = cloneOf(s, "dev");
  const listings = counted(s, dev);
  let now = 1_762_100_000_000;
  const hand = handTimer();
  const r = readerOf(dev, {
    policy: shared("refs/squeal", lookAgain),
    timer: hand.timer,
    now: () => now,
  });
  await r.run();
  expect(r.commits()).toEqual([c0]);
  const c1 = landed(ci.root, "c1");
  git(dev, ["pull", "-q", "--ff-only"]);
  await r.run();
  expect(r.commits()).toEqual([c0]);
  const fire = async (advanceMs: number) => {
    now += advanceMs;
    hand.fire();
    await r.reader.idle();
  };
  return { s, ci: ci.root, dev, c0, c1, r, hand, listings, fire };
}

describe("the reader looks again for a missing export (row 018-70)", () => {
  it("imports a ref published after the start point moved, without a restart", async () => {
    const { ci, c0, c1, r, hand, listings, fire } = await movedBeforePublish(MINUTES_10);
    expect(hand.pending()).toEqual([30_000]);
    // A batch at the same start point lists nothing: the timer looks.
    const before = listings();
    await r.run();
    expect(listings()).toBe(before);

    await fire(30_000);
    expect(listings()).toBe(before + 1);
    expect(hand.pending()).toEqual([30_000]);
    await publish(ci, c1);
    await fire(30_000);
    expect(r.commits().sort()).toEqual([c0, c1].sort());
    expect(hand.pending()).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("with forSeconds 0 looks once per start point, as before", async () => {
    const { ci, c0, c1, r, hand, listings } = await movedBeforePublish({
      everySeconds: 30,
      forSeconds: 0,
    });
    expect(hand.pending()).toEqual([]);
    await publish(ci, c1);
    const before = listings();
    await r.run();
    expect(listings()).toBe(before);
    expect(r.commits()).toEqual([c0]);
    expect(r.notes).toEqual([]);
  });

  it("lists nothing after its window, its last look at the window's end, and notes once", async () => {
    const { ci, c1, r, hand, listings, fire } = await movedBeforePublish({
      everySeconds: 30,
      forSeconds: 45,
    });
    expect(hand.pending()).toEqual([30_000]);
    await fire(30_000);
    expect(hand.pending()).toEqual([15_000]);
    expect(r.notes).toEqual([]);
    await fire(15_000);
    expect(hand.pending()).toEqual([]);
    expect(r.notes).toEqual([
      `CI results: origin had no refs/squeal/${c1} after 45 s; tests run here as before`,
    ]);

    await publish(ci, c1);
    const after = listings();
    await r.run();
    expect(listings()).toBe(after);
    expect(r.notes).toHaveLength(1);
  });

  it("lists nothing once closed, even when its timer fires", async () => {
    const { r, hand, listings } = await movedBeforePublish(MINUTES_10);
    const before = listings();
    const late = hand.last();
    r.reader.close();
    expect(hand.pending()).toEqual([]);
    // A timer that fired as the reader closed: its nudge starts nothing.
    late();
    await r.reader.idle();
    expect(listings()).toBe(before);
  });

  it("stops looking for a start point once it moves, and takes the new one's export", async () => {
    const { ci, c0, c1, r, hand, dev } = await movedBeforePublish(MINUTES_10);
    expect(hand.pending()).toEqual([30_000]);
    const c2 = landed(ci, "c2");
    await publish(ci, c2);
    git(dev, ["pull", "-q", "--ff-only"]);
    await r.run();
    expect(r.commits().sort()).toEqual([c0, c2].sort());
    expect(r.commits()).not.toContain(c1);
    expect(hand.pending()).toEqual([]);
  });

  it("counts a failed listing as a miss, noted once, and looks again", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    const dev = cloneOf(s, "dev");
    const hand = handTimer();
    const r = readerOf(dev, { policy: shared("refs/squeal", MINUTES_10), timer: hand.timer });
    git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
    await r.run();
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(/^CI results: could not list refs\/squeal on origin/);
    expect(hand.pending()).toEqual([30_000]);
    hand.fire();
    await r.reader.idle();
    expect(r.notes).toHaveLength(1);
    expect(hand.pending()).toEqual([30_000]);

    git(dev, ["remote", "set-url", "origin", s.remote]);
    await publish(ci.root, c0);
    hand.fire();
    await r.reader.idle();
    expect(r.commits()).toEqual([c0]);
    expect(hand.pending()).toEqual([]);
  });
});
