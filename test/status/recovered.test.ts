import { describe, expect, it } from "vitest";
import { readStatus } from "../../src/core/status/index.js";
import { META_STORE_RECOVERED } from "../../src/core/store/index.js";
import type { StatusResult, StatusSnapshot } from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Row 011-226 (spec 011, store failures as amended 2026-10-25): status says
 * why the baseline was lost. A store moved aside for the mark of a failed
 * full check names that check; one the start's quick check moved keeps the
 * line it had.
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
});
