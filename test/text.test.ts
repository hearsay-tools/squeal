import { describe, expect, it } from "vitest";
import { cap, plural } from "../src/core/text.js";

describe("plural", () => {
  it("adds an s unless the count is one", () => {
    expect(plural(0, "check")).toBe("0 checks");
    expect(plural(1, "check")).toBe("1 check");
    expect(plural(2, "test file")).toBe("2 test files");
  });
});

describe("cap", () => {
  it("keeps text within the limit and cuts longer text to the limit with ...", () => {
    expect(cap("abcdef", 6)).toBe("abcdef");
    expect(cap("abcdefg", 6)).toBe("abc...");
  });
});
