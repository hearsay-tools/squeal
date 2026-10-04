import { expect, it } from "vitest";
import { upper } from "../src/strings.ts";

it("uppercases", () => {
  expect(upper("a")).toBe("A");
});
