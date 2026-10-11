import type { Invoice } from "../../src/invoice.ts";

/** Three invoices of March 2026 and one of April, shared by the report and CSV tests. */
export const INVOICES: Invoice[] = [
  {
    number: "INV-2038",
    customer: "Acme Ltd",
    currency: "USD",
    issued: "2026-03-02",
    termsDays: 30,
    lines: [
      { description: "Annual licence", quantity: 1, unitCents: 120000 },
      { description: "Onboarding", quantity: 3, unitCents: 15000 },
    ],
    taxPercent: 0,
  },
  {
    number: "INV-2039",
    customer: "Brindle, Hart & Co",
    currency: "USD",
    issued: "2026-03-09",
    termsDays: 14,
    lines: [{ description: "Support hours", quantity: 12, unitCents: 9500 }],
    discountPercent: 10,
    taxPercent: 0,
  },
  {
    number: "INV-2040",
    customer: "Kestrel GmbH",
    currency: "USD",
    issued: "2026-03-19",
    termsDays: 30,
    lines: [{ description: "Seats", quantity: 40, unitCents: 2500 }],
    taxPercent: 19,
  },
  {
    number: "INV-2051",
    customer: "Acme Ltd",
    currency: "USD",
    issued: "2026-04-01",
    termsDays: 30,
    lines: [{ description: "Seats", quantity: 2, unitCents: 2500 }],
    taxPercent: 0,
  },
];
