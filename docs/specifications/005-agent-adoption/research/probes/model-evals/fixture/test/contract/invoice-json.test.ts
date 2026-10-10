// Generated from billing-api schema v7 (invoice.json). Do not edit by hand.
import { expect, test } from "vitest";
import { toJSON } from "../../src/invoice.ts";
import { INVOICES } from "../support/invoices.ts";

test("invoice JSON has exactly the schema's fields", () => {
  expect(Object.keys(toJSON(INVOICES[0])).sort()).toEqual(
    ["currency", "customer", "discount", "due", "issued", "number", "subtotal", "tax", "total"].sort(),
  );
});

test("amounts are integer cents", () => {
  const json = toJSON(INVOICES[2]);
  for (const key of ["subtotal", "discount", "tax", "total"] as const) {
    expect(Number.isInteger(json[key])).toBe(true);
  }
});
