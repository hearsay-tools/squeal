/** Consumer views, deltas and messages, spec 001 D6 and D9. Task 001-21. */

export {
  createDelivery,
  DEFAULT_POLL_INTERVAL_MS,
  type DeliveryOptions,
  expireConsumers,
} from "./delivery.js";
export { type DeltaPlan, type PlanInput, planDelta } from "./delta.js";
export { formatDelta, formatRegistration, MESSAGE_CAP_CHARS } from "./format.js";
export { readHeader } from "./header.js";
