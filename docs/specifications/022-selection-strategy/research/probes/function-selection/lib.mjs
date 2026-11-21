// Throwaway probe helpers for research/function-selection.md. Read-only store copies only.
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync, constants } from "node:zlib";
import { execFileSync } from "node:child_process";

export const open = (path) => new DatabaseSync(path, { readOnly: true });
const SYNC = { finishFlush: constants.Z_SYNC_FLUSH };
const MANIFEST_HEAD = '{"v":1,"sources":[],"parts":';

/** A coverage reader over a code store copy: `record(key)` gives { sources: Map(path -> source), unread: Set, paths: Set } or null. */
export function coverageReader(codePath) {
  const c = open(codePath);
  const byKey = c.prepare("select record from coverage where result_key = ? order by provider_version desc limit 1");
  const part = c.prepare("select part from coverage_parts where id = ?");
  const partCache = new Map();
  const readPart = (id) => {
    if (partCache.has(id)) return partCache.get(id);
    const row = part.get(id);
    const value = row ? JSON.parse(inflateRawSync(row.part, SYNC).toString("utf8")) : null;
    if (partCache.size > 200000) partCache.clear();
    partCache.set(id, value);
    return value;
  };
  return {
    has: (key) => !!byKey.get(key),
    record(key) {
      const row = byKey.get(key);
      if (!row) return null;
      const text = inflateRawSync(row.record, SYNC).toString("utf8");
      const json = JSON.parse(text);
      const sources = new Map();
      let unread;
      if (text.startsWith(MANIFEST_HEAD)) {
        let at = 0, id = 0;
        unread = new Set((json.unreadAt ?? []).map((i) => json.unread[i]));
        for (let i = 0; i < json.parts.length; i += 2) {
          at += json.parts[i]; id += json.parts[i + 1];
          const src = readPart(id);
          const path = json.unread[at];
          if (!src || src.path !== path) unread.add(path); else sources.set(path, src);
        }
        return { sources, unread, paths: new Set(json.unread) };
      }
      for (const s of json.sources) sources.set(s.path, s);
      unread = new Set(json.unread);
      return { sources, unread, paths: new Set([...sources.keys(), ...unread]) };
    },
  };
}

/** Git blob reader through `git cat-file --batch`, run once per call set. */
export function blobReader(gitDir) {
  const cache = new Map();
  return {
    prefetch(hashes) {
      const want = [...new Set(hashes)].filter((h) => h && !cache.has(h));
      for (let i = 0; i < want.length; i += 2000) {
        const chunk = want.slice(i, i + 2000);
        const out = execFileSync("git", ["--git-dir", gitDir, "cat-file", "--batch"], { input: chunk.join("\n") + "\n", maxBuffer: 4e9 });
        let pos = 0;
        for (const h of chunk) {
          const nl = out.indexOf(10, pos);
          const head = out.toString("utf8", pos, nl);
          if (head.endsWith("missing")) { cache.set(h, null); pos = nl + 1; continue; }
          const size = Number(head.split(" ")[2]);
          cache.set(h, out.toString("utf8", nl + 1, nl + 1 + size));
          pos = nl + 1 + size + 1;
        }
      }
    },
    get: (h) => cache.get(h),
  };
}

export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
