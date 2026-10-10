import { dueDate } from "./clock.ts";
import { type Invoice, total } from "./invoice.ts";
import { formatMoney } from "./money.ts";

const HEADER = "number,customer,due,total";

function field(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The accounting export, RFC 4180 CSV: one row per invoice. */
export function toCsv(invoices: Invoice[]): string {
  const rows = invoices.map((invoice) =>
    [
      invoice.number,
      field(invoice.customer),
      dueDate(invoice.issued, invoice.termsDays),
      formatMoney(total(invoice), invoice.currency),
    ].join(","),
  );
  return [HEADER, ...rows].join("\n");
}
