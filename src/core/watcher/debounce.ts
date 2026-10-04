/**
 * Collects items into batches that close after a quiet period or a maximum
 * age, whichever comes first.
 *
 * Spec 001 D2: "Each debounced batch (100 ms quiet, 500 ms maximum)".
 */
export class Debouncer<T> {
  private items: T[] = [];
  private quietTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onFlush: (items: T[]) => void,
    private readonly timings: { readonly quietMs: number; readonly maxBatchMs: number },
  ) {}

  get pending(): boolean {
    return this.items.length > 0;
  }

  push(items: Iterable<T>): void {
    const before = this.items.length;
    for (const item of items) this.items.push(item);
    if (this.items.length === before) return;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.flush(), this.timings.quietMs);
    this.maxTimer ??= setTimeout(() => this.flush(), this.timings.maxBatchMs);
  }

  flush(): void {
    const items = this.items;
    this.cancel();
    if (items.length > 0) this.onFlush(items);
  }

  cancel(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.quietTimer = null;
    this.maxTimer = null;
    this.items = [];
  }
}
