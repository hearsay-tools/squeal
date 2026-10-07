import { expect, it } from "vitest";

it("imports no installed package", () => {
  expect((globalThis as { setupValue?: string }).setupValue).toMatch(/^setup-/);
});
