import { K1 } from "./k1-flip.js";
import { K2 } from "./k2-two-hops.js";
import { K3 } from "./k3-load-error.js";
import type { Scenario } from "./types.js";

export type { Module, Outcome, Scenario, Step } from "./types.js";
export { isTest } from "./types.js";

/** Every scenario, in the order each runner's kit file plays them (spec 016 D1). */
export const SCENARIOS: readonly Scenario[] = [K1, K2, K3];
