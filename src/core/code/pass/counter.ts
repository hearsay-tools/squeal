import { COUNTER_VERSION, countFile } from "../count/index.js";
import type { Counter } from "./types.js";

/** Spec 015 D3: 015-05's counter, as the daemon's pass counts with it. */
export const treeSitterCounter: Counter = {
  version: COUNTER_VERSION,
  async count(text, language) {
    const { functions, errors } = await countFile(text, language);
    return { functions, errors };
  },
};
