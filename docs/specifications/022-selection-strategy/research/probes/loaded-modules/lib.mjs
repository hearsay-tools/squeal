// Throwaway probe helpers for research/loaded-modules.md. Read-only store copies only.
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync, constants } from "node:zlib";

export function open(path) {
  return new DatabaseSync(path, { readOnly: true });
}

const MANIFEST_HEAD = '{"v":1,"sources":[],"parts":';

/** The paths a coverage record holds: its sources (loaded and mapped) and its unread paths (loaded, bytes unknown). */
export function loadedPaths(bytes) {
  const text = inflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
  const json = JSON.parse(text);
  if (text.startsWith(MANIFEST_HEAD)) {
    // manifest: `unread` lists every path the record holds (parts.ts)
    return { paths: json.unread, unread: (json.unreadAt ?? []).map((i) => json.unread[i]) };
  }
  return { paths: [...json.sources.map((s) => s.path), ...json.unread], unread: json.unread };
}

export function inflateJson(bytes) {
  return JSON.parse(inflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8"));
}
