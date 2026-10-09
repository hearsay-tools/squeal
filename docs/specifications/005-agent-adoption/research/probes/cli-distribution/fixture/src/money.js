/** Formats integer cents as "1234.56 EUR". */
export function formatMoney(cents, currency = "EUR") {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}${units}.${rest} ${currency}`;
}

/** Converts an amount in units to integer cents. */
export function toCents(amount) {
  return Math.round(amount * 100);
}
