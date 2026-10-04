import { describe, expect, it } from "vitest";
import { add, addBase } from "../src/math.ts";

describe("math", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("adds base", () => {
    expect(addBase(1)).toBe(11);
  });
});
