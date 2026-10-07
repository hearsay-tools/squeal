import { actual } from "outer";
import { expect, it } from "vitest";

// Review wave-11d S2: `outer -> middle -> spawner`, and the config plugin also declares `spawner`.
it("calls a spawning package the config plugin also reaches", () => {
  expect(actual()).toBe("one");
});
