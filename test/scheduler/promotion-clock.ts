import type { PromotionClock } from "../../src/core/scheduler/promotions.js";

/** Row 011-364: a queue's promotions on the host's clock with no file running, as a bare `RunQueue` had them. */
export const HOST_PROMOTIONS: PromotionClock = { now: () => Date.now(), isRunning: () => false };
