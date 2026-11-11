import { expect, it } from "vitest";
import { save } from "../src/store";

it("saves", () => {
  expect(save(1)).toBe(2);
});
