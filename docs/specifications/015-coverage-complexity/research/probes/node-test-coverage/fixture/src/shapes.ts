// Throwaway (015-76): TypeScript that a loader must transform, not only strip.
export interface Shape {
  readonly kind: "square" | "circle";
  readonly size: number;
}

export enum Unit {
  Metre,
  Foot,
}

export type Pair<T> = readonly [T, T];

export function area(shape: Shape): number {
  if (shape.kind === "square") return shape.size * shape.size;
  return Math.PI * shape.size * shape.size;
}

export function convert(value: number, unit: Unit): number {
  switch (unit) {
    case Unit.Metre:
      return value;
    case Unit.Foot:
      return value * 0.3048;
  }
}

export class Ledger<T> {
  #items: T[] = [];
  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  add = (item: T): number => this.#items.push(item);

  describe(): string {
    return `${this.label}: ${this.#items.length}`;
  }

  neverCalled(pair: Pair<number>): number {
    const [a, b] = pair;
    return a > b ? a - b : b - a;
  }
}

export const largest = (shapes: readonly Shape[]): Shape | undefined =>
  shapes.reduce<Shape | undefined>((best, s) => (best === undefined || area(s) > area(best) ? s : best), undefined);
