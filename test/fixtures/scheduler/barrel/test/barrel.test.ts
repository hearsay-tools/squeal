import { expect, it } from "vitest";
import { upper } from "../src/index.ts";

/** Slow, and affected by every module the barrel re-exports. */
it("uppercases after a while", async () => {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(upper("a")).toBe("A");
});
