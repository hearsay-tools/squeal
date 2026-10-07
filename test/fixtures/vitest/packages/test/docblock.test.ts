// @vitest-environment docblock
import { expect, it } from "vitest";

// Review wave-11b B1: the docblock names `vitest-environment-docblock`.
it("runs in an environment a docblock names", () => {
  expect((globalThis as { environmentName?: string }).environmentName).toMatch(/^docblock-/);
});
