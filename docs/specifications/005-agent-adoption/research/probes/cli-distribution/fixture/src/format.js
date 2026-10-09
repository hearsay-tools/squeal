import { lineTotal, total } from "./invoice.js";
import { formatMoney } from "./money.js";

/** Renders an invoice as plain text, one line per item and a total. */
export function renderInvoice(invoice) {
  const rows = invoice.lines.map(
    (line) => `${line.name} x${line.qty}: ${formatMoney(lineTotal(line), invoice.currency)}`,
  );
  rows.push(`Total: ${formatMoney(total(invoice.lines), invoice.currency)}`);
  return rows.join("\n");
}
