import { expect, it } from "vitest";
import { add } from "../src/index.ts";

/** Sorts first by path, takes 1.5 s, and reaches `src/math.ts` only through the barrel. */
it("adds after a while", async () => {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(add(1, 2)).toBe(3);
});
