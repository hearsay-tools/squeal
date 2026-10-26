import { describe, it } from "vitest";
import { replay } from "./replay.js";

describe("the 200-edit replay on ESLint 9 (spec 017 goal 5)", () => {
  it(
    "gives a fresh CLI's results at every step, refreshed at D4's levels",
    () => replay(9),
    1_800_000,
  );
});
