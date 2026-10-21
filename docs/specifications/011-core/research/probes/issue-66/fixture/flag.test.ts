import { expect, test } from "vitest";
test("setup ran", () => {
  expect((globalThis as { FLAG?: number }).FLAG).toBeGreaterThan(0);
});
