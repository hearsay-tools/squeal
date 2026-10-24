import type { StateSink } from "../../types/index.js";

/**
 * Row 015-12 (agreed with the coordinator): the daemon's state sink, with
 * `then` called after each call that stores results or marks files
 * `unknown`, a lookup's adopted results included, so the code pass judges
 * CRAP again. `then` coalesces and does nothing while coverage is off
 * (`CodePass.soon`); a throw from it is not the sink's.
 */
export function afterResults(sink: StateSink, then: () => void): StateSink {
  const after = <T>(value: T): T => {
    try {
      then();
    } catch {
      // The pass's nudge only schedules a timer.
    }
    return value;
  };
  return {
    ...sink,
    applyResults: (...args) => after(sink.applyResults(...args)),
    markUnknown: (...args) => after(sink.markUnknown(...args)),
  };
}
