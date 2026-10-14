import { expect, it } from "vitest";
import { shared } from "../src/shared.ts";

it("runs in api-client", () => {
  expect(shared).toBe(1);
});
