import { expect, it } from "vitest";
import { slow } from "../src/a";

// Never ends inside any budget a test gives: a deterministic sleep, not load.
it("slow", async () => {
  await new Promise((done) => setTimeout(done, 600_000));
  expect(slow(1)).toBe(3);
});
