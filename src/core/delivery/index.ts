/** Consumer views, deltas and messages, spec 001 D6 and D9. Task 001-21. */

/** The shared header reader lives with the known state; hooks import it from here too. */
export { readHeader } from "../state/index.js";
export {
  createDelivery,
  DEFAULT_POLL_INTERVAL_MS,
  type DeliveryOptions,
  expireConsumers,
} from "./delivery.js";
export { type DeltaPlan, type PlanInput, planDelta } from "./delta.js";
export { formatDelta, formatRegistration, MESSAGE_CAP_CHARS } from "./format.js";
