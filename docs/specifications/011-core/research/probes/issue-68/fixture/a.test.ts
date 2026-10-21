import { expect, test } from "vitest";
import { value } from "./helper";
test("helper value", () => {
  expect(value()).toBeGreaterThan(0);
});
