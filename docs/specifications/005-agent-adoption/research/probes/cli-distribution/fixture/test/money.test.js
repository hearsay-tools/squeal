import { describe, expect, test } from "vitest";
import { formatMoney, toCents } from "../src/money.js";

describe("formatMoney", () => {
  test("formats cents with two decimals", () => {
    expect(formatMoney(1234)).toBe("12.34 EUR");
  });
  test("pads small amounts", () => {
    expect(formatMoney(5)).toBe("0.05 EUR");
  });
  test("keeps the sign", () => {
    expect(formatMoney(-250, "PLN")).toBe("-2.50 PLN");
  });
  test("formats large amounts", () => {
    expect(formatMoney(123456)).toBe("1234.56 EUR");
  });
});

describe("toCents", () => {
  test("rounds to whole cents", () => {
    expect(toCents(1.005)).toBe(100);
    expect(toCents(19.99)).toBe(1999);
  });
});
