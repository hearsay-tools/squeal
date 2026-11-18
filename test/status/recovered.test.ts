import { describe, expect, it } from "vitest";
import { readStatus } from "../../src/core/status/snapshot.js";
import { META_STORE_RECOVERED } from "../../src/core/store/open.js";
import type { StatusResult, StatusSnapshot } from "../../src/core/types/status.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Row 011-226 (spec 011, store failures as amended 2026-10-25): status says
 * why the baseline was lost. A store moved aside for the mark of a failed
 * full check names that check; one moved without a finder keeps the line
 * it had. Row 011-391: a note names what found the fault: a start's open, a
 * daemon's read or write, or a hook's.
 */

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const MOVED_TO = "/repo/.git/squeal/store.sqlite.corrupt-1";

function notesOf(result: StatusResult): StatusSnapshot["notes"] {
  if (!result.available) throw new Error(`unavailable: ${result.message}`);
  return result.notes;
}

describe("the recovery line in status (row 011-226)", () => {
  it("names the full integrity check when its mark moved the store aside", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const recovered = { at: Date.UTC(2026, 9, 26, 9, 0, 0), movedTo: MOVED_TO };
    store.meta.set(
      META_STORE_RECOVERED,
      JSON.stringify({
        ...recovered,
        reason: "row 1 missing from index fault_a",
        check: "full",
        checkedAt: Date.UTC(2026, 9, 26, 8, 0, 0),
      }),
    );
    expect(notesOf(readStatus(repo.main, { now: () => NOW }))).toContain(
      "store was recovered from corruption at 2026-10-26T09:00:00.000Z: the full integrity check " +
        "at 2026-10-26T08:00:00.000Z found a fault; the baseline was lost (corrupt file moved to " +
        `${MOVED_TO})`,
    );

    store.meta.set(
      META_STORE_RECOVERED,
      JSON.stringify({ ...recovered, reason: "database disk image is malformed" }),
    );
    expect(notesOf(readStatus(repo.main, { now: () => NOW }))).toContain(
      "store was recovered from corruption at 2026-10-26T09:00:00.000Z; the baseline was lost " +
        `(corrupt file moved to ${MOVED_TO})`,
    );
  });

  it("names a start's open, a daemon's read or write, and a hook's (row 011-391)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const recovered = { at: Date.UTC(2026, 9, 26, 9, 0, 0), movedTo: MOVED_TO, reason: "x" };
    const markedAt = Date.UTC(2026, 9, 26, 8, 30, 0);
    const lineOf = (note: Record<string, unknown>) => {
      store.meta.set(META_STORE_RECOVERED, JSON.stringify({ ...recovered, ...note }));
      return notesOf(readStatus(repo.main, { now: () => NOW })).find((line) =>
        line.startsWith("store was recovered"),
      );
    };
    const tail = `; the baseline was lost (corrupt file moved to ${MOVED_TO})`;
    const head = "store was recovered from corruption at 2026-10-26T09:00:00.000Z: ";

    expect(lineOf({ found: "start" })).toBe(
      `${head}a daemon start's open of the store found a fault${tail}`,
    );
    expect(lineOf({ found: "daemon", markedAt })).toBe(
      `${head}a daemon's read or write of the store at 2026-10-26T08:30:00.000Z found a fault${tail}`,
    );
    expect(lineOf({ found: "hook", markedAt })).toBe(
      `${head}a hook's open, read or write of the store at 2026-10-26T08:30:00.000Z found a fault${tail}`,
    );
    expect(lineOf({ found: "full-check", check: "full", checkedAt: markedAt })).toBe(
      `${head}the full integrity check at 2026-10-26T08:30:00.000Z found a fault${tail}`,
    );
    // Row 011-392 (d): a mark cut short names no finder.
    expect(lineOf({ found: "unknown" })).toBe(
      `store was recovered from corruption at 2026-10-26T09:00:00.000Z${tail}`,
    );
  });
});
