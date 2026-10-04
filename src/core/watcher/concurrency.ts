/** How many paths are stat'ed at once, so a 10k-file pass does not queue 10k filesystem calls. */
export const STAT_CONCURRENCY = 64;

/** `Promise.all` over `items` with at most `limit` calls in flight. Results keep input order. */
export async function mapConcurrent<T, R>(
  items: Iterable<T>,
  fn: (item: T, index: number) => Promise<R>,
  limit = STAT_CONCURRENCY,
): Promise<R[]> {
  const list = [...items];
  const results = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await fn(list[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}
