import { expect, it } from "vitest";
import { add } from "../src/index.ts";

/** Sorts last by path, is fast, and reaches `src/math.ts` only through the barrel. */
it("adds", () => {
  expect(add(2, 2)).toBe(4);
});
