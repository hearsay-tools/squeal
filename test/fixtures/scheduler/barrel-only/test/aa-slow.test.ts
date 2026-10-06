import { beforeAll, expect, it } from "vitest";
import { add } from "../src/index.ts";

/**
 * Sorts first by path, takes 1.5 s in `beforeAll`, and reaches `src/math.ts`
 * only through the barrel. Its test case is quick: only the module's own
 * duration says it is slow (review wave 4.5, N1).
 */
beforeAll(() => new Promise((resolve) => setTimeout(resolve, 1_500)));

it("adds", () => {
  expect(add(1, 2)).toBe(3);
});
