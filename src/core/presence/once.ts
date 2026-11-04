/**
 * `read`, run at the first call only (row 011-293, review 0.1.403 B2): a fact
 * or a decision nobody asks for is never read, and one read twice is read once.
 */
export function once<T>(read: () => T): () => T {
  let value: { readonly v: T } | null = null;
  return () => {
    value ??= { v: read() };
    return value.v;
  };
}
