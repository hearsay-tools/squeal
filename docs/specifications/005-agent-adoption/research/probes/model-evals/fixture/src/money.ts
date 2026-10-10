export type Currency = "USD" | "EUR" | "GBP";

const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£" };

/** Parses "1234", "1234.5" or "-1234.50" into integer cents. Throws on anything else. */
export function toCents(text: string): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) throw new Error(`not an amount: ${text}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

/** An amount for people: "$1234.50", and "-$12.00" for a negative one. */
export function formatMoney(cents: number, currency: Currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${SYMBOL[currency]}${whole}.${frac}`;
}

/** A percentage of an amount, rounded half up to the cent. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}
