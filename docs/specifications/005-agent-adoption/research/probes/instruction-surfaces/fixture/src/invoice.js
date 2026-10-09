/** One line's total in cents. */
export function lineTotal(line) {
  return line.qty * line.unitCents;
}

/** The invoice total in cents. */
export function total(lines) {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/** Applies a percentage discount, rounding to whole cents. */
export function applyDiscount(cents, percent) {
  return Math.round(cents * (1 - percent / 100));
}
