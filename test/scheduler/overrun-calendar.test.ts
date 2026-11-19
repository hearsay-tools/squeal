import { describe, expect, it } from "vitest";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import { besideRuns, facts, hung, overrunsOf } from "./overrun-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Review 0.1.567 B2 (row 011-399): the overrun's threshold, its reported
 * age and its reported deadline count on one basis, the tier's start moved by
 * the calendar steps since (row 011-377), whether the calendar steps before
 * the overrun is published or after. Before the repair, a set-back of 1 h
 * before publication read `ranMs` 0 and a deadline 69 min away for a tier
 * that had run 60 s of a 600 s timeout. The daemon's record starts 2 h
 * earlier, so the row's stamp floor (row 011-386) plays no part. The run row
 * keeps its stored start as provenance.
 */

const HOUR = 3_600_000;
const TIMEOUT_MS = 600_000;

describe("an overrun's age and deadline count on the threshold's basis (review 0.1.567 B2)", {
  timeout: 120_000,
}, () => {
  for (const shift of [-HOUR, HOUR]) {
    const way = shift < 0 ? "back" : "forward";

    it(`the calendar set ${way} 1 h before the overrun is published`, async () => {
      const { side, hung: gate, beside, start, clock } = await hung();
      clock.shiftCalendar(shift);
      side.advance(OVERRUN_FLOOR_MS);
      await settle(side);
      expect(besideRuns(side, 0).length).toBeGreaterThan(0);
      const [overrun] = overrunsOf(side);
      expect(overrun?.startedAt).toBe(start + shift);
      expect(overrun?.at).toBe(start + shift + OVERRUN_FLOOR_MS);
      expect(overrun?.deadline).toBe(start + shift + TIMEOUT_MS);
      expect(facts(side)).toEqual({
        ranMs: OVERRUN_FLOOR_MS,
        leftMs: TIMEOUT_MS - OVERRUN_FLOOR_MS,
      });
      gate.stop();
      beside.stop();
    });

    it(`the calendar set ${way} 1 h after the overrun is published`, async () => {
      const { side, hung: gate, beside, start, clock } = await hung();
      side.advance(OVERRUN_FLOOR_MS);
      await settle(side);
      expect(overrunsOf(side).map((o) => o.startedAt)).toEqual([start]);
      clock.shiftCalendar(shift);
      side.advance(1_000);
      await settle(side);
      // The row moved with the calendar: what status reads is still 61 s run, 539 s left.
      const [overrun] = overrunsOf(side);
      expect(overrun?.startedAt).toBe(start + shift);
      expect(overrun?.deadline).toBe(start + shift + TIMEOUT_MS);
      const ran = OVERRUN_FLOOR_MS + 1_000;
      expect(facts(side)).toEqual({ ranMs: ran, leftMs: TIMEOUT_MS - ran });
      gate.stop();
      beside.stop();
    });
  }
});
