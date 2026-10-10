/** Dates are ISO calendar days ("2026-03-02") in UTC; no times. */

const DAY_MS = 24 * 60 * 60 * 1000;

function parse(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`not a day: ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return format(new Date(parse(day).getTime() + days * DAY_MS));
}

export function weekday(day: string): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" {
  return (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const)[parse(day).getUTCDay()];
}

/**
 * The day an invoice is due: `termsDays` calendar days after it was issued.
 * A due date on a weekend moves to the following Monday.
 */
export function dueDate(issued: string, termsDays: number): string {
  const due = addDays(issued, termsDays);
  if (weekday(due) === "Sat") return addDays(due, 2);
  return due;
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}
