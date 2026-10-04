/** How many files are stat'ed or read at once. Bounds memory when a checkout rewrites thousands. */
export const FILE_CONCURRENCY = 64;

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight. Results keep input order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = FILE_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
