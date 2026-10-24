import type { CoverageSource } from "../../../src/core/code/coverage/index.js";

/*
 * Spec 015 D9 (row 015-12): a source and the record entry Squeal's provider
 * made for it on Node 24.21.0, from a test that calls `add(1, 2)`,
 * `branchy(20)`, `twice([])` and `new Counter().increment()`.
 */

export const SOURCE = `export function add(a: number, b: number): number {
  return a + b;
}

export const twice = (xs: number[]) => xs.map((x) => x * 2);

export function branchy(n: number): string {
  if (n > 10) {
    return "big";
  }
  const inner = () => {
    return n;
  };
  return n > 0 ? "small" : String(inner());
}

export class Counter {
  #count = 0;
  increment(): number {
    this.#count += 1;
    return this.#count;
  }
  get value(): number {
    return this.#count;
  }
}

export const obj = {
  method(a: number) {
    return a;
  },
  arrow: (b: number) => (b ? 1 : 2),
};

function never(x: number) {
  return x * 3;
}
export { never };
`;

/** Lines 1, 2, 5, 7, 8, 9, 11, 12, 14, 17 to 21, 23, 24, 28 to 30, 32, 35, 36 can run. */
export const TESTED: CoverageSource = {
  path: "src/math.ts",
  blob: "b".repeat(40),
  lines: "0y3fuAw=",
  covered: "0wEfiA==",
  functions: [
    [1, 7, 3, 0, 1],
    [5, 13, 5, 58, 1],
    [5, 42, 5, 57, 0],
    [7, 7, 15, 0, 1],
    [11, 8, 13, 2, 0],
    [18, 2, 18, 11, 1],
    [19, 2, 22, 2, 1],
    [23, 2, 25, 2, 0],
    [29, 2, 31, 2, 0],
    [32, 2, 32, 33, 0],
    [35, 0, 37, 0, 0],
  ],
};
