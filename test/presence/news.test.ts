import { afterEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta, readLiveHeader } from "../../src/core/delivery/index.js";
import { recordHeartbeat } from "../../src/core/presence/index.js";
import { DEATH_CAUSE } from "../../src/core/status/died.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import type { Consumer, Delta, EpochMs } from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { at, type Stored, scratch } from "./fixture.js";

/*
 * Row 011-295 (`research/daemon-presence.md`, "Accidental differences"): news
 * tells every presence state and note the header tells, except a late change
 * feed, each change once per consumer. A late heartbeat and the death after
 * it are told as the header words them.
 */

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

const consumer = (sessionId: string, worktreeId: Consumer["worktreeId"]): Consumer => ({
  worktreeId,
  sessionId,
  agentId: "main",
});

/** A registered pair of consumers over `stored`: by default a daemon heartbeating at -2 s, its lock held. */
async function twoConsumers(stored: Stored = { heartbeat: -2_000, lock: "held" }) {
  const { store, id, release } = scratch(stored);
  let freed = false;
  const free = () => {
    if (!freed) release();
    freed = true;
  };
  releases.push(free);
  let clock = at(0);
  const delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  const [c1, c2] = [consumer("s1", id), consumer("s2", id)];
  await delivery.register(c1);
  await delivery.register(c2);
  const boundary = (c: Consumer) => delivery.onToolBoundary(c);
  const to = (offset: number) => {
    clock = at(offset) as EpochMs;
  };
  return { store, id, boundary, to, free, c1, c2 };
}

const text = (delta: Delta | null) => (delta === null ? null : formatDelta(delta));

describe("news tells a late heartbeat and a death once per consumer (row 011-295)", () => {
  it("tells the late heartbeat, then the death after it, as the header words them", async () => {
    const { boundary, to, free, c1, c2 } = await twoConsumers();
    to(9_000);
    const late = text(await boundary(c1));
    expect(late).toMatch(/^SQUEAL · the daemon's heartbeat is late at revision 2\n/);
    expect(late).toContain("The daemon's heartbeat is late: the last one was 11 s ago");
    expect(await boundary(c1)).toBeNull();

    free();
    to(10_000);
    const died = text(await boundary(c1));
    expect(died).toMatch(/^SQUEAL · no daemon is validating at revision 2\n/);
    expect(died).toContain(
      `The last daemon died without shutting down, between runs. ${DEATH_CAUSE}`,
    );
    expect(await boundary(c1)).toBeNull();

    // The other consumer, told nothing since its registration, hears the death alone, once.
    const other = text(await boundary(c2));
    expect(other).toMatch(/^SQUEAL · no daemon is validating at revision 2\n/);
    expect(other).toContain("The last daemon died without shutting down");
    expect(await boundary(c2)).toBeNull();
  });

  it("starts no delivery for a late change feed, which the header says", async () => {
    const { store, id, boundary, to, c1 } = await twoConsumers({ heartbeat: -2_000, feed: -1_000 });
    to(FEED_LATE_MS);
    store.transaction(() => recordHeartbeat(store, id, at(FEED_LATE_MS - 1_000)));
    expect(readLiveHeader(store, id, at(FEED_LATE_MS)).daemon).toMatchObject({ late: {} });
    expect(await boundary(c1)).toBeNull();
  });
});
