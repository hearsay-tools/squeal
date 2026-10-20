import type { Case } from "../case.js";
import { GOLDEN_KEYS } from "./key/golden.js";
import { GOLDEN_ROWS } from "./rows/golden.js";

/** The corpus: every case, run at both trees when the comparison fires. A case joins with the change that needs it. */
export const CASES: readonly Case[] = [...GOLDEN_KEYS, ...GOLDEN_ROWS];
