import { expect, test } from "vitest";
import { plain } from "../src/plain.ts";

test("plain", () => {
  expect(plain).toBe(1);
});
