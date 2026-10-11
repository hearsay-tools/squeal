import { describe, expect, test } from "vitest";
import { formatMoney, percentOf, toCents } from "../src/money.ts";

describe("toCents", () => {
  test("parses whole amounts and cents", () => {
    expect(toCents("12")).toBe(1200);
    expect(toCents("12.5")).toBe(1250);
    expect(toCents("-0.07")).toBe(-7);
  });

  test("rejects anything else", () => {
    expect(() => toCents("12,50")).toThrow("not an amount");
    expect(() => toCents("1.234")).toThrow("not an amount");
  });
});

describe("formatMoney", () => {
  test("formats cents with the currency symbol", () => {
    expect(formatMoney(1250)).toBe("$12.50");
    expect(formatMoney(5, "EUR")).toBe("€0.05");
  });

  test("formats large amounts", () => {
    expect(formatMoney(123456789)).toBe("$1234567.89");
    expect(formatMoney(100000, "GBP")).toBe("£1000.00");
  });

  test("puts the sign before the symbol", () => {
    expect(formatMoney(-1200)).toBe("-$12.00");
  });
});

describe("percentOf", () => {
  test("rounds half up to the cent", () => {
    expect(percentOf(1050, 10)).toBe(105);
    expect(percentOf(125, 10)).toBe(13);
  });
});
