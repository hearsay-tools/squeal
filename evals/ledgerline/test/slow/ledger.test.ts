import { expect, test } from "vitest";
import { total } from "../../src/invoice.ts";
import { formatMoney } from "../../src/money.ts";
import { INVOICES } from "../support/invoices.ts";

/** Stands in for the ledger database round trip the real reconciliation does. */
const roundTrip = () => new Promise((resolve) => setTimeout(resolve, 12_000));

test("the year's ledger reconciles with the invoices", async () => {
  await roundTrip();
  const year = Array.from({ length: 12 }, () => INVOICES).flat();
  const sum = year.reduce((acc, invoice) => acc + total(invoice), 0);
  expect(formatMoney(sum)).toBe("$46992.00");
}, 30_000);
