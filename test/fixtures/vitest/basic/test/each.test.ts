import { expect, test } from "vitest";
import { add } from "../src/math.ts";

test("static name", () => {
  expect(add(0, 0)).toBe(0);
});

test.each([
  [1, 1, 2],
  [2, 3, 5],
])("add(%i, %i) = %i", (a, b, expected) => {
  expect(add(a, b)).toBe(expected);
});
