import { expect, test } from "vitest";
import { applyDiscount, lineTotal, total } from "../src/invoice.js";

const lines = [
  { name: "Widget", qty: 3, unitCents: 250 },
  { name: "Gadget", qty: 1, unitCents: 1999 },
];

test("lineTotal multiplies quantity by unit price", () => {
  expect(lineTotal(lines[0])).toBe(750);
});
test("total sums the lines", () => {
  expect(total(lines)).toBe(2749);
});
test("applyDiscount rounds to whole cents", () => {
  expect(applyDiscount(2749, 10)).toBe(2474);
});
