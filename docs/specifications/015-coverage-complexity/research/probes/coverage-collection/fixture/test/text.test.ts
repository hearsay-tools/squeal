import { expect, test } from "vitest";
import { pad } from "../src/text.js";

test("pad", () => {
  expect(pad("a", 3)).toBe("a  ");
});
