import { afterEach, describe, expect, it } from "vitest";
import {
  editLineView,
  headerView,
  newsChange,
  presenceState,
  readPresence,
  statusView,
} from "../../src/core/presence/index.js";
import { at, scratch, selfChecked } from "./fixture.js";
import { rows } from "./rows.js";

/*
 * Row 011-293: the presence module at its interface. Stored facts and a
 * clock in; the presence state with its notes, and each view's output, out.
 * Status's view is the status JSON payload's `daemon`, compared as JSON, so
 * its keys keep their order (decision 4: byte for byte). A row names the
 * header, news and edit-line views only where they differ from status.
 */

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("daemon presence: stored facts in, each view out (row 011-293)", () => {
  it("names the recorded daemon as the fixture's marks do", () => {
    expect(selfChecked).toBe(true);
  });

  it.each(rows)("$name", (row) => {
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
    expect(editLineView(presence)).toEqual(row.editLine ?? presence.heartbeat);
  });
});
