import { describe, expect, it } from "vitest";
import { half } from "../src/fails";

describe("half", () => {
  it("halves", () => expect(half(4)).toBe(2));
  it("is wrong", () => expect(half(4)).toBe(3));
});
