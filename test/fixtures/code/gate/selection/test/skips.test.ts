import { describe, expect, it } from "vitest";
import { grade } from "../src/skips";

describe("grade", () => {
  it("is a function", () => expect(typeof grade).toBe("function"));
  it.skip("grades a score", () => expect(grade(95)).toBe("A"));
});
