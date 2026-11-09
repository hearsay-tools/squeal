import { expect, it } from "vitest";
import { patient } from "../src/a";

// Longer than Vitest's default testTimeout (5 s), well inside the budget.
it("patient", async () => {
  await new Promise((done) => setTimeout(done, 6_000));
  expect(patient(1)).toBe(2);
});
