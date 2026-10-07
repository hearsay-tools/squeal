import { extValue } from "ext";
import { expect, it } from "vitest";

it("loads an externalized package and its declared dependency", () => {
  expect(extValue).toMatch(/^ext\+trans-/);
});
