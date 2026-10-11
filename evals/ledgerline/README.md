# ledgerline

Invoices, reports and CSV exports for a small billing back office.

- `src/money.ts`: amounts in integer cents, parsing and formatting.
- `src/invoice.ts`: line items, discounts, tax, totals, the invoice's JSON shape.
- `src/clock.ts`: issue and due dates.
- `src/report.ts`: the monthly summary text.
- `src/csv.ts`: the accounting CSV export.
- `scripts/changelog.mjs`: renders `CHANGELOG.md` entries from `changes.json`.

`npm test` runs the Vitest suite; `npm run test:scripts` runs the scripts' own `node:test` tests.
