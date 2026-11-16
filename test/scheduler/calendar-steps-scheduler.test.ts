import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import {
  backlogRuns,
  backlogStarts,
  cancelBacklog,
  holdBacklog,
  quietSide,
} from "./backlog-quiet-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Row 011-377 (`tasks/011-377/notes.md`, "Design"): the scheduler tells
 * each wait owner a calendar step (`#shift`). A real scheduler on the
 * virtual clock: a lane's quiet after its backlog tier's cancel lasts its
 * 20 s of elapsed time when the calendar is set back or forward 1 h during
 * it. Until 0.1.523 a set-back held the backlog about 1 h more and a
 * set-forward started it at the next look. The owners one by one are
 * `calendar-steps.test.ts`.
 */

const HOUR = 3_600_000;

describe("a calendar step during a lane's quiet (row 011-377)", { timeout: 120_000 }, () => {
  it.each([
    { shift: -HOUR, row: "set back 1 h" },
    { shift: HOUR, row: "set forward 1 h" },
  ])(
    "the backlog starts 20 s of elapsed time after the cancel, the calendar $row",
    async ({ shift }) => {
      const quiet = await quietSide([], { clock: "virtual" });
      const { side } = quiet;
      const gate = holdBacklog(side.runner);
      const after = await cancelBacklog(quiet);
      quiet.advance(1_000);
      side.clock?.shiftCalendar(shift);
      await settle(side);
      quiet.advance(BACKLOG_QUIET_MS - 2_000);
      await settle(side);
      expect(backlogRuns(side, after)).toEqual([]);
      quiet.advance(1_000);
      await backlogStarts(side, after);
      gate.stop();
      await settle(side);
    },
  );
});
