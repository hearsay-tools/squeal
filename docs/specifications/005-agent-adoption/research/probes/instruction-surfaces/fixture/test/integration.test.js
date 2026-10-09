import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { applyDiscount, total } from "../src/invoice.js";
import { renderInvoice } from "../src/format.js";
import { formatMoney } from "../src/money.js";

// Stands in for a slower end-to-end test: an invoice through every module.
test("a quarterly invoice renders end to end", async () => {
  await sleep(2500);
  const invoice = {
    currency: "PLN",
    lines: [
      { name: "Hosting", qty: 3, unitCents: 45000 },
      { name: "Support", qty: 12, unitCents: 9900 },
    ],
  };
  expect(renderInvoice(invoice)).toBe(
    "Hosting x3: 1350.00 PLN\nSupport x12: 1188.00 PLN\nTotal: 2538.00 PLN",
  );
  expect(formatMoney(applyDiscount(total(invoice.lines), 5), "PLN")).toBe("2411.10 PLN");
}, 10000);
