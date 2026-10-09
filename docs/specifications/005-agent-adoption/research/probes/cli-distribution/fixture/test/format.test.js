import { expect, test } from "vitest";
import { renderInvoice } from "../src/format.js";

test("renders each line and the total", () => {
  const text = renderInvoice({
    currency: "EUR",
    lines: [
      { name: "Desk", qty: 1, unitCents: 129900 },
      { name: "Lamp", qty: 2, unitCents: 4550 },
    ],
  });
  expect(text).toBe("Desk x1: 1299.00 EUR\nLamp x2: 91.00 EUR\nTotal: 1390.00 EUR");
});
