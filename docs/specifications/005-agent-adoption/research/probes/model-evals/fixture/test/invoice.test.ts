import { describe, expect, test } from "vitest";
import { discount, subtotal, tax, total } from "../src/invoice.ts";
import { INVOICES } from "./support/invoices.ts";

const [licence, support, seats] = INVOICES;

describe("invoice totals", () => {
  test("subtotal sums quantity times unit price", () => {
    expect(subtotal(licence)).toBe(165000);
  });

  test("discount applies to the subtotal", () => {
    expect(discount(support)).toBe(11400);
    expect(total(support)).toBe(102600);
  });

  test("tax applies after the discount", () => {
    expect(tax(seats)).toBe(19000);
    expect(total(seats)).toBe(119000);
  });
});
