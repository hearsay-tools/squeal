import { expect, it } from "vitest";
import { add } from "../src/index.ts";

/**
 * Sorts last by path and reaches `src/math.ts` only through the barrel. Its
 * test case takes 200 ms, longer than `aa-slow`'s, but the module is far
 * shorter than `aa-slow`'s.
 */
it("adds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(add(2, 2)).toBe(4);
});
