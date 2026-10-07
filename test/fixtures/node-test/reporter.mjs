// Writes every TestsStream event as one NDJSON line, as spec 003 D5's reporter
// will. Error fields are non-enumerable, so they are copied by name.
const encode = (value, seen = new WeakSet()) => {
  if (typeof value === "bigint") return String(value);
  if (value === null || typeof value !== "object") return value ?? null;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const out = Array.isArray(value)
    ? value.map((v) => encode(v, seen))
    : Object.fromEntries(Object.getOwnPropertyNames(value).map((k) => [k, encode(value[k], seen)]));
  seen.delete(value);
  return out;
};

export default async function* reporter(events) {
  for await (const event of events) yield `${JSON.stringify(encode(event))}\n`;
}
