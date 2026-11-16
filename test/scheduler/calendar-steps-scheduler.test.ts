import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { type VirtualClock, virtualClock } from "../helpers/virtual-clock.js";
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

/**
 * Review 0.1.524 B2: a prompt virtual clock whose calendar steps `shift`
 * once, on the first reading taken inside a frame named `frame` after
 * `trigger()`: a step between the pump's decision and its wake's delay.
 */
function stepInside(frame: string, shift: number) {
  const inner = virtualClock(Date.now(), { prompt: true });
  let waiting = false;
  const clock: VirtualClock = {
    now: () => {
      if (waiting && (new Error().stack ?? "").includes(frame)) {
        waiting = false;
        inner.shiftCalendar(shift);
      }
      return inner.now();
    },
    elapsed: () => inner.elapsed(),
    arm: (ms, fire) => inner.arm(ms, fire),
    advance: (ms) => inner.advance(ms),
    jump: (ms) => inner.jump(ms),
    shiftCalendar: (ms) => inner.shiftCalendar(ms),
    get armed() {
      return inner.armed;
    },
  };
  return {
    clock,
    trigger: () => {
      waiting = true;
    },
    stepped: () => !waiting,
  };
}

describe("a calendar step between the pump's decision and its wake (review 0.1.524 B2)", {
  timeout: 120_000,
}, () => {
  it("a set-back 1 h inside the pump's wait adds nothing: the backlog starts 20 s after the cancel", async () => {
    const stepping = stepInside("#eventOrAt", -HOUR);
    const quiet = await quietSide([], { clock: stepping.clock });
    const { side } = quiet;
    const gate = holdBacklog(side.runner);
    const after = await cancelBacklog(quiet);
    stepping.trigger();
    quiet.advance(1_000);
    await settle(side);
    expect(stepping.stepped()).toBe(true);
    quiet.advance(BACKLOG_QUIET_MS - 2_000);
    await settle(side);
    expect(backlogRuns(side, after)).toEqual([]);
    quiet.advance(1_000);
    await backlogStarts(side, after);
    gate.stop();
    await settle(side);
  });
});
