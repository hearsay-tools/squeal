import { expect, it } from "vitest";
import { shared } from "../src/shared.ts";

it("runs in web", () => {
  expect(shared).toBe(1);
});
