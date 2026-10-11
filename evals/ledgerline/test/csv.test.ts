import { expect, test } from "vitest";
import { toCsv } from "../src/csv.ts";
import { INVOICES } from "./support/invoices.ts";
import { parseCsv } from "./support/parse-csv.ts";

test("every row has the header's four fields", () => {
  const rows = parseCsv(toCsv(INVOICES));
  for (const row of rows) expect(row).toHaveLength(4);
});

test("quotes a customer name with a comma", () => {
  const rows = parseCsv(toCsv(INVOICES));
  expect(rows[2][1]).toBe("Brindle, Hart & Co");
});

test("exports the formatted total", () => {
  const rows = parseCsv(toCsv(INVOICES));
  expect(rows[1]).toEqual(["INV-2038", "Acme Ltd", "2026-04-01", "$1650.00"]);
});
