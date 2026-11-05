// Row 011-294: the handoff claim and the short handoff are daemon presence's (`presence/stored.ts`, `presence/events.ts`).
export {
  claimHandoff,
  clearHandoff,
  endHandoff,
  type Registering,
} from "../presence/events.js";
export {
  HANDOFF_BOUND_MS,
  type HandoffClaim,
  handoffFrom,
  handoffMetaKey,
  liveHandoff,
  readHandoff,
  readShortHandoff,
  type ShortHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
  shortHandoffMetaKey,
} from "../presence/stored.js";
