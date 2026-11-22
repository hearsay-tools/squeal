import { stopSlowTier } from "../handlers.js";
import { runMain } from "../main.js";

await runMain("stop-slow", stopSlowTier);
