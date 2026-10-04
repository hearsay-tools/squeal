import { expect, it } from "vitest";
import { value } from "../src/value.ts";

it("runs in every project", () => {
  expect(value).toBe(1);
});
