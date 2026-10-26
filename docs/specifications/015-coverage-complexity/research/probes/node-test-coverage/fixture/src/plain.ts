// Throwaway (015-76): TypeScript that type stripping alone can run.
type Range = { low: number; high: number };

export function clamp(value: number, range: Range): number {
  if (value < range.low) return range.low;
  if (value > range.high) return range.high;
  return value;
}

export function unused(value: number): number {
  return value * 2;
}
