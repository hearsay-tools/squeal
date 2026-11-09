// The file Stryker mutates.
export function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function grade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  return score >= 50 ? "C" : "F";
}
