import { afterEach, describe, expect, it } from "vitest";
import {
  editLineView,
  headerView,
  heartbeatFresh,
  heartbeatLateBy,
  newsChange,
  presenceState,
  readPresence,
  spawnStartCurrent,
  statusView,
  stopHeld,
  toldOf,
} from "../../src/core/presence/index.js";
import { at, scratch, selfChecked } from "./fixture.js";
import { rows } from "./rows.js";
import { stopRows } from "./rows-stop.js";

/*
 * Row 011-293: the presence module at its interface. Stored facts and a
 * clock in; the presence state with its notes, and each view's output, out.
 * Status's view is the status JSON payload's `daemon`, compared as JSON, so
 * its keys keep their order (decision 4: byte for byte). A row names the
 * header, news and edit-line views only where they differ from status; its
 * told values are a previous release's, which read as that release read
 * them (row 011-295), so news is status where its alive or down differs. The
 * readers that keep their own decision (row 011-295 makes them consistent)
 * read the heartbeat rule, here with the fixture's 5 s interval, and the hook
 * spawn's start (`spawnStartCurrent`).
 */

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("daemon presence: stored facts in, each view out (row 011-293)", () => {
  it("names the recorded daemon as the fixture's marks do", () => {
    expect(selfChecked).toBe(true);
  });

  it.each([...rows, ...stopRows])("$name", (row) => {
    const { store, id, release } = scratch(row.stored);
    releases.push(release);
    const now = at(row.now ?? 0);
    const presence = readPresence(store, id, now);
    const told = row.told ?? "alive";
    const header = row.header ?? row.status;
    const was = typeof told === "object" ? "alive" : told;
    const news = row.news !== undefined ? row.news : row.status.state === was ? null : row.status;

    expect(presenceState(presence)).toEqual({ state: row.state, notes: row.notes ?? [] });
    expect(JSON.stringify(statusView(presence))).toBe(JSON.stringify(row.status));
    expect(headerView(presence)).toEqual(header);
    expect(headerView(presence, told)).toEqual(row.toldHeader ?? header);
    expect(newsChange(presence, told)).toEqual({
      change: news,
      forgetRest: row.forgetRest === true,
    });
    // Row 011-295: news is told once; what it told says it again to no one.
    if (news !== null) expect(newsChange(presence, toldOf(news)).change).toBeNull();
    expect(editLineView(presence.facts, now)).toEqual(row.editLine ?? presence.heartbeat);
    expect(stopHeld(presence.facts, now)).toEqual(row.heldStop ?? null);
    expect(presence.stop).toEqual(row.heldStop ?? null);
    expect(spawnStartCurrent(store.worktrees.get(id), now)).toBe(row.spawn === true);
    const age = row.stored.heartbeat === undefined ? null : (row.now ?? 0) - row.stored.heartbeat;
    const lateBy = age !== null && age > 10_000 ? age : null;
    const { record } = presence;
    expect(record === null ? null : heartbeatLateBy(record, now)).toBe(lateBy);
    expect(record !== null && heartbeatFresh(record, now)).toBe(age !== null && lateBy === null);
  });
});
