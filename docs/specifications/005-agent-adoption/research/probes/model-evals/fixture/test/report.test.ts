import { expect, test } from "vitest";
import { monthlySummary } from "../src/report.ts";
import { INVOICES } from "./support/invoices.ts";

test("summarises one month's invoices", () => {
  expect(monthlySummary(INVOICES, "2026-03")).toBe(
    [
      "Invoices issued in 2026-03: 3",
      "INV-2038  Acme Ltd        due 2026-04-01  $1650.00",
      "INV-2039  Brindle, Hart & Co  due 2026-03-23  $1026.00",
      "INV-2040  Kestrel GmbH    due 2026-04-20  $1190.00",
      "Total: $3866.00",
    ].join("\n"),
  );
});

test("an empty month has a zero total", () => {
  expect(monthlySummary(INVOICES, "2026-05")).toBe("Invoices issued in 2026-05: 0\nTotal: $0.00");
});
