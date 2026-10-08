/** Consumer views, deltas and messages, spec 001 D6 and D9. Task 001-21. */

/** The shared header reader lives with the known state; hooks import it from here too. */
export { readHeader } from "../state/index.js";
export { otherSessionVersions, recordVersion, versionMetaKey } from "./consumer-version.js";
export {
  createDelivery,
  DEFAULT_POLL_INTERVAL_MS,
  type DeliveryOptions,
} from "./delivery.js";
export { type DeltaPlan, type PlanInput, planDelta } from "./delta.js";
export {
  departedMetaKey,
  dropGoneHarnesses,
  type ExpiryOptions,
  expireConsumers,
  lastDeparture,
} from "./expiry.js";
export {
  formatDelta,
  formatRegistration,
  MESSAGE_CAP_CHARS,
  notValidatedLine,
  SQUEAL_COMMAND,
  shellWord,
} from "./format.js";
export { harnessOf, type ProcStat, pidNamespace, readProcStat } from "./harness-process.js";
export {
  daemonLiveness,
  livenessMetaKey,
  readLiveHeader,
  worktreeLiveness,
} from "./liveness.js";
