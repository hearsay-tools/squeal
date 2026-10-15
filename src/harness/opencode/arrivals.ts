/*
 * Review 008-27 B1: per session, how many messages and aborts reached any
 * Squeal plugin instance in this OpenCode process. Once `dispose` began,
 * OpenCode routes new input and an abort's event to the instance it
 * re-creates, and calls `chat.message` before it stores the message, so
 * neither the disposing instance's epoch nor the session's messages show
 * it yet. Kept on `globalThis`, so a module evaluated again shares it.
 * Runs in OpenCode's Bun: no imports.
 */

const KEY = Symbol.for("squeal.opencode.arrivals");
const scope = globalThis as { [KEY]?: Map<string, number> };
scope[KEY] ??= new Map();
const counts = scope[KEY];

/** A message or an abort of session `id` reached a plugin instance. */
export function arrived(id: string): void {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

/** How many messages and aborts of session `id` reached plugin instances so far. */
export function arrivals(id: string): number {
  return counts.get(id) ?? 0;
}
