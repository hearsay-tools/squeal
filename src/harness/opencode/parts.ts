/*
 * Spec 008 D3 as amended: a part added in `chat.message` needs an `id`
 * starting `prt` that sorts after the message's own parts, or OpenCode fails
 * the user's whole prompt (`research/wave-0-checks.md` 4). Runs in
 * OpenCode's Bun: no imports.
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * A part id OpenCode accepts (`prt_` and its ascending identifier: 12 hex
 * digits of time and a counter, then 14 base62 characters) for `now`.
 */
export function partId(now: number = Date.now()): string {
  const time = (BigInt(now) * 0x1000n + 0xfffn).toString(16).padStart(12, "0").slice(-12);
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `prt_${time}${Array.from(bytes, (byte) => BASE62[byte % 62]).join("")}`;
}

/**
 * The id of a part added after `parts` (review 008-15 S2): a fresh `partId`
 * when it sorts after every id there, else the greatest id with `z`
 * appended, which sorts after it and names no part there. `null`, so the
 * caller adds nothing, when a part has no string id starting `prt`.
 */
export function partAfter(parts: readonly unknown[], now: number = Date.now()): string | null {
  let last = "";
  for (const part of parts) {
    const id = (part as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id.startsWith("prt")) return null;
    if (id > last) last = id;
  }
  const fresh = partId(now);
  return fresh > last ? fresh : `${last}z`;
}
