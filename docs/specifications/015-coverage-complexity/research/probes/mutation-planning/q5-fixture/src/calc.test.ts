import { describe, expect, it } from "vitest";
import { clamp, grade } from "./calc.js";
describe("calc", () => {
  it("clamps", async () => { await new Promise((r) => setTimeout(r, 1500)); expect(clamp(5, 0, 10)).toBe(5); expect(clamp(-1, 0, 10)).toBe(0); expect(clamp(11, 0, 10)).toBe(10); });
  it("grades", () => { expect(grade(95)).toBe("A"); expect(grade(80)).toBe("B"); expect(grade(60)).toBe("C"); expect(grade(10)).toBe("F"); });
});
