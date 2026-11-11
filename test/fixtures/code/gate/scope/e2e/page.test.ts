import { expect, it } from "vitest";
import { seeded } from "./helper";

it("shows the seeded value", () => {
  expect(seeded()).toBe(42);
});
