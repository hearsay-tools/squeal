import { describe, expect, it } from "vitest";
import type { TreeCpu } from "../../src/core/capacity/cores.js";
import { readMarks } from "../../src/core/capacity/marks.js";
import { createPermitPool } from "../../src/core/capacity/pool.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { CatchUpFile, CatchUpOptions } from "./catch-up-fixture.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { FOUR_SHORT, importers, transitive } from "./edit-cut-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Review 0.1.584 B2 (row 011-424): each step states the catch-up a wait for
 * quiet holds in its last 30 s in the pool mark, before it chooses between
 * a start, a wait on claims and a wait for quiet. Before the repair the
 * live view's quiet wake stated it, which the plan reads only after the
 * claims: an edit that started lane one's wait again while lane two's
 * catch-up waited on another worktree's claims left the old demand in the
 * mark, and a peer was offered part of the slots. Two lanes, each a source
 * with its own test and six direct importers, of which the cut keeps four:
 * lane two's catch-up is its two slow importers, lane one's those and six
 * files through a hub. 23 slots, the ceiling above them; one virtual clock.
 */

const A = "src/a.ts";
const B = "src/b.ts";
const ONE: CatchUpFile[] = [
  { path: "src/a.test.ts", ms: 900, imports: [A] },
  ...importers("d", A, FOUR_SHORT),
  ...transitive("t", A, 6),
];
const TWO: CatchUpFile[] = [
  { path: "src/b.test.ts", ms: 900, imports: [B] },
  ...importers("e", B, FOUR_SHORT),
];
const FILES = [...ONE, ...TWO];
const TWO_PATHS = new Set(TWO.map((f) => f.path));
const SLOTS = 23;
const idle: TreeCpu = { read: () => 0, reset() {} };
const S = 1_000;

describe("a step withdraws a restarted quiet's demand (review 0.1.584 B2)", {
  timeout: 120_000,
}, () => {
  it("while lane two's catch-up waits on another worktree's claims, the peer is offered every slot", async () => {
    const repo = catchUpRepo(FILES);
    const options: CatchUpOptions = {
      files: FILES,
      hostSlots: SLOTS,
      policy: RUN_MISSING,
      lane: (ref: TestFileRef) => (TWO_PATHS.has(ref.path) ? "two" : "one"),
    };
    const main = catchUpSide(repo, repo.main, { ...options, clock: "virtual" });
    await main.scheduler.start();
    await settle(main);
    const clock = main.clock;
    if (clock === null) throw new Error("the main side has no virtual clock");
    const other = catchUpSide(repo, repo.other, { ...options, clock });
    await other.scheduler.start();
    await settle(other);
    const dir = repo.poolDir as AbsolutePath;
    const peer = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "peer" },
      hostSlots: SLOTS,
      cpus: 64,
      cores: idle,
      host: null,
    });
    const markOf = (id: string) => readMarks(dir, "reader", Date.now()).find((m) => m.id === id);
    const demand = () => markOf(main.worktreeId)?.want ?? 0;
    /** The slots the other's held tier leaves: all of them are the peer's when no one else wants. */
    const free = () => SLOTS - (markOf(other.worktreeId)?.grant ?? 0);

    // t 0: the other worktree changes B; its edit's tiers run, its catch-up waits until 120 s.
    await other.edit("watch", B);
    await settle(other, main);
    // t 5: the same bytes of B here: lane two's catch-up waits until 125 s.
    main.advance(5 * S);
    await main.edit("watch", B);
    await settle(main);
    // t 20: A here: lane one's catch-up waits until 140 s.
    main.advance(15 * S);
    await main.edit("watch", A);
    await settle(other, main);

    // t 120: the other's catch-up of B, its two slow importers, starts and is held, its keys claimed.
    other.runner.hold();
    main.advance(100 * S);
    await expect.poll(() => other.runner.active).toBe(1);
    // t 126: lane two's wait ended, its files wait on the claims; lane one's states its demand.
    const before = main.runner.runs.length;
    // Its daemon beats on the virtual clock, so its claims stay a live worktree's.
    other.stopBeat();
    main.store.worktrees.heartbeat(other.worktreeId as WorktreeId, main.now() + 6 * S);
    main.advance(6 * S);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(main.runner.runs.length).toBe(before);
    expect(demand()).toBeGreaterThan(0);
    expect(free()).toBeLessThan(SLOTS);
    expect(peer.offer(SLOTS, "fast", "backlog")).toBeLessThan(free());

    // t 127: an edit of A starts lane one's wait again, to 247 s: its demand goes, though the
    // step chooses the wait on claims; the peer is offered every slot the other's tier leaves.
    main.advance(S);
    await main.edit("watch", A);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(demand()).toBe(0);
    expect(peer.offer(SLOTS, "fast", "backlog")).toBe(free());

    peer.close();
    other.runner.release();
  });
});
