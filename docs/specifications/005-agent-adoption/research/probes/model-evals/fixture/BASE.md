# ledgerline

TypeScript, ESM, Node 24. Amounts are integer cents everywhere; they are formatted only at the edges (`src/report.ts`, `src/csv.ts`).

- `test/contract/` is generated from the billing API's schema in another repository; never edit it by hand.
- Keep changes small and in the style of the surrounding code.
