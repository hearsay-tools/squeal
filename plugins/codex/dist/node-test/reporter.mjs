// Squeal's node:test reporter (spec 003 D5). Runs inside the project's Node, so it imports
// nothing. Writes every TestsStream event as one NDJSON line. Error fields such as `message`,
// `stack` and `cause` are non-enumerable, so every own property is copied by name.

const encode = (value, seen) => {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[function ${value.name}]`;
  if (typeof value === "symbol") return value.toString();
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const out = Array.isArray(value)
    ? value.map((v) => encode(v, seen))
    : Object.fromEntries(
        Object.getOwnPropertyNames(value).map((key) => [key, encode(value[key], seen)]),
      );
  seen.delete(value);
  return out;
};

export default async function* squealReporter(events) {
  for await (const event of events) yield `${JSON.stringify(encode(event, new WeakSet()))}\n`;
}
