import { inlValue } from "inl";
import { expect, it } from "vitest";

it("loads an inlined package and its dependency", () => {
  expect(inlValue).toMatch(/^inl\+inl-trans-/);
});
