import { dueDate } from "./clock.ts";
import { type Invoice, total } from "./invoice.ts";
import { formatMoney } from "./money.ts";

/** The monthly summary finance pastes into its newsletter: one line per invoice, then the total. */
export function monthlySummary(invoices: Invoice[], month: string): string {
  const inMonth = invoices.filter((invoice) => invoice.issued.startsWith(month));
  const lines = inMonth.map(
    (invoice) =>
      `${invoice.number}  ${invoice.customer.padEnd(14)}  due ${dueDate(invoice.issued, invoice.termsDays)}  ${formatMoney(total(invoice), invoice.currency)}`,
  );
  const sum = inMonth.reduce((acc, invoice) => acc + total(invoice), 0);
  return [`Invoices issued in ${month}: ${inMonth.length}`, ...lines, `Total: ${formatMoney(sum)}`].join("\n");
}
