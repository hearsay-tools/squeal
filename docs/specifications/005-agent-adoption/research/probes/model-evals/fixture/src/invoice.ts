import { dueDate } from "./clock.ts";
import { type Currency, percentOf } from "./money.ts";

export interface Line {
  description: string;
  quantity: number;
  unitCents: number;
}

export interface Invoice {
  number: string;
  customer: string;
  currency: Currency;
  issued: string;
  termsDays: number;
  lines: Line[];
  discountPercent?: number;
  taxPercent: number;
}

export function subtotal(invoice: Invoice): number {
  return invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0);
}

export function discount(invoice: Invoice): number {
  return percentOf(subtotal(invoice), invoice.discountPercent ?? 0);
}

export function tax(invoice: Invoice): number {
  return percentOf(subtotal(invoice) - discount(invoice), invoice.taxPercent);
}

export function total(invoice: Invoice): number {
  return subtotal(invoice) - discount(invoice) + tax(invoice);
}

/** The invoice as the billing API exchanges it (see test/contract/). */
export function toJSON(invoice: Invoice) {
  return {
    number: invoice.number,
    customer: invoice.customer,
    currency: invoice.currency,
    issued: invoice.issued,
    due: dueDate(invoice.issued, invoice.termsDays),
    subtotal: subtotal(invoice),
    discount: discount(invoice),
    tax: tax(invoice),
    total: total(invoice),
  };
}
