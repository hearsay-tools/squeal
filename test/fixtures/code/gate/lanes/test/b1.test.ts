import { expect, it } from "vitest";
import { b } from "../src/b";

it("b1", () => {
  expect(b(1)).toBe(1);
});
