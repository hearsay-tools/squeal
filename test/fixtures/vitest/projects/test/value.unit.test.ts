import { expect, it } from "vitest";
import { value } from "../src/value.ts";

it("reads the value", () => {
  expect(value).toBe(1);
});
