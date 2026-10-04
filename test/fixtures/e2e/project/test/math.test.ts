import { describe, expect, it } from "vitest";
import { add, mul } from "../src/math.js";

describe("math", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
  });
  it("multiplies", () => {
    expect(mul(2, 3)).toBe(6);
  });
});
