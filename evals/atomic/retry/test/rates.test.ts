import { expect, test } from "vitest";
import { rate } from "../src/rates.ts";

test("converts euros to dollars at today's rate", async () => {
  expect(await rate("EUR", "USD")).toBe(1.08);
});
