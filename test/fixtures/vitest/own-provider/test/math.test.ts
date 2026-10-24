import { expect, test } from "vitest";
import { add, clamp } from "../src/math.js";

test("add", () => {
  expect(add(1, 2)).toBe(3);
});

test("clamp low", () => {
  expect(clamp(-1, 0, 10)).toBe(0);
});
