// Preserve non-enumerable Error fields; plain JSON.stringify loses message/stack.
export function encode(value, seen = new WeakSet()) {
  if (typeof value === 'bigint') return String(value);
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const result = Array.isArray(value) ? value.map(x => encode(x, seen)) :
    Object.fromEntries(Object.getOwnPropertyNames(value).map(k => [k, encode(value[k], seen)]));
  seen.delete(value);
  return result;
}
export function line(event) { return JSON.stringify(encode(event)) + '\n'; }
