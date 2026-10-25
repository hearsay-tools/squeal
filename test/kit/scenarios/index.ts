import { K1 } from "./k1-flip.js";
import { K2 } from "./k2-two-hops.js";
import { K3 } from "./k3-load-error.js";
import { K4 } from "./k4-runtime-read.js";
import { K5 } from "./k5-startup-hook.js";
import { K6 } from "./k6-dependency.js";
import { K7 } from "./k7-same-stat.js";
import { K8 } from "./k8-cut.js";
import { K9 } from "./k9-missing.js";
import { K10 } from "./k10-two-worktrees.js";
import type { Scenario } from "./types.js";

export type { Module, Outcome, Scenario, Step, Written } from "./types.js";
export { isTest } from "./types.js";

/** Every scenario, in the order each runner's kit file plays them (spec 016 D1). */
export const SCENARIOS: readonly Scenario[] = [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10];
