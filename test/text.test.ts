import { describe, expect, it } from "vitest";
import { plural } from "../src/core/text.js";

describe("plural", () => {
  it("adds an s unless the count is one", () => {
    expect(plural(0, "check")).toBe("0 checks");
    expect(plural(1, "check")).toBe("1 check");
    expect(plural(2, "test file")).toBe("2 test files");
  });
});
