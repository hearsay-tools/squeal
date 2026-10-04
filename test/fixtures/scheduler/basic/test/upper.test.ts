import { expect, it } from "vitest";
import { upper } from "../src/strings.ts";

it("uppercases words", () => {
  expect(upper("ab")).toBe("AB");
});
