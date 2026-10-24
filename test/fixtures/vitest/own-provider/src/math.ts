export function add(a: number, b: number): number {
  return a + b;
}

export function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export const arrow = (flag: boolean): string => (flag ? "yes" : "no");

export class Counter {
  #count = 0;
  increment(): number {
    this.#count += 1;
    return this.#count;
  }
}
