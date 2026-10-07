import { spawned } from "spawner";
import { expect, it } from "vitest";

// Review wave-11b B3: `spawner` runs a child that loads `child-pkg`, which no import names.
it("uses a package that spawns a child loading another package", () => {
  expect(spawned()).toMatch(/^child-/);
});
