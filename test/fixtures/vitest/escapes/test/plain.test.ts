import { expect, it } from "vitest";

// Imports no installed package: the config plugin alone reaches `spawner`, so this keeps its key.
it("imports no installed package", () => {
  expect(1).toBe(1);
});
