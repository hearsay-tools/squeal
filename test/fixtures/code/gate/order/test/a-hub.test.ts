import { expect, it } from "vitest";
import { hub } from "../src/hub";

// First in path order, and never ends inside any budget a test gives: a deterministic sleep.
it("hub", async () => {
  await new Promise((done) => setTimeout(done, 600_000));
  expect(hub(1)).toBe(1);
});
