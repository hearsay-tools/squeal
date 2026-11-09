// Throwaway probe for research/mutation-planning.md (row 015-125).
// Reads a COPY of a Squeal store pair (store.sqlite and code.sqlite, taken with -wal and -shm) and writes
// an index: for each product source under packages/*/src, the test files whose newest coverage record
// names it, with the blob the run executed, whether a function other than the module top level ran
// ("called"), the record's function spans with hits, and the covered-line bitset.
// usage: node records.mjs <dir with store.sqlite and code.sqlite> <out.json>
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync, constants } from "node:zlib";
import { writeFileSync } from "node:fs";

const [dir, out] = process.argv.slice(2);
const store = new DatabaseSync(`${dir}/store.sqlite`, { readOnly: true });
const code = new DatabaseSync(`${dir}/code.sqlite`, { readOnly: true });
const SYNC = { finishFlush: constants.Z_SYNC_FLUSH };
const keyTest = store.prepare("select c.project p, c.test_path t, r.worktree_id w from results r join checks c on c.id = r.check_id where r.key = ? and c.kind = 'file' limit 1");
const getPart = code.prepare("select part from coverage_parts where id = ?");
const HEAD = Buffer.from('{"v":1,"sources":[],"parts":');

// newest record per (project, test file)
const newest = new Map();
let noTest = 0;
for (const r of code.prepare("select result_key k, provider_version v, recorded_at a from coverage").all()) {
  const t = keyTest.get(r.k);
  if (!t) { noTest++; continue; }
  const id = `${t.p}\0${t.t}`;
  const n = newest.get(id);
  if (!n || n.a < r.a) newest.set(id, { ...r, project: t.p, test: t.t, worktree: t.w });
}
const getRec = code.prepare("select record from coverage where result_key = ? and provider_version = ?");
const partCache = new Map();
function part(id) {
  if (partCache.has(id)) return partCache.get(id);
  let v = null;
  try { const b = getPart.get(id)?.part; if (b) v = JSON.parse(inflateRawSync(b, SYNC).toString("utf8")); } catch {}
  partCache.set(id, v);
  return v;
}
const PRODUCT = /^packages\/[^/]+\/src\/.+\.(ts|tsx)$/;
const NOT_PRODUCT = /(^|\/)(__tests__|__fixtures__|fixtures|test|tests)\/|\.(test|testkit|spec|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const index = {};
let records = 0, unreadPaths = 0;
for (const r of newest.values()) {
  const bytes = getRec.get(r.k, r.v).record;
  const raw = Buffer.from(bytes);
  let sources = [], unread = [];
  if (raw.subarray(0, 5 + HEAD.length).includes(HEAD)) {
    const m = JSON.parse(inflateRawSync(raw).toString("utf8"));
    let at = 0, id = 0;
    for (let i = 0; i < m.parts.length; i += 2) {
      at += m.parts[i]; id += m.parts[i + 1];
      const p = part(id);
      if (p && p.path === m.unread[at]) sources.push(p); else unread.push(m.unread[at]);
    }
    for (const i of m.unreadAt) unread.push(m.unread[i]);
  } else {
    const rec = JSON.parse(inflateRawSync(raw).toString("utf8"));
    sources = rec.sources; unread = rec.unread;
  }
  records++;
  for (const s of sources) {
    if (!PRODUCT.test(s.path) || NOT_PRODUCT.test(s.path)) continue;
    const called = s.functions.some((f) => f[4] === 1 && !(f[0] === 1 && f[1] === 0));
    (index[s.path] ??= []).push({ test: r.test, project: r.project, blob: s.blob, called, functions: s.functions, covered: s.covered, lines: s.lines, at: r.a });
  }
  for (const p of unread) {
    unreadPaths++;
    if (PRODUCT.test(p) && !NOT_PRODUCT.test(p)) (index[p] ??= []).push({ test: r.test, project: r.project, blob: null, called: null, at: r.a });
  }
}
writeFileSync(out, JSON.stringify({ records, noTest, unreadPaths, sources: Object.keys(index).length, from: Math.min(...[...newest.values()].map((r) => r.a)), to: Math.max(...[...newest.values()].map((r) => r.a)), worktrees: [...new Set([...newest.values()].map((r) => r.worktree))].length, index }));
console.log({ records, noTest, unreadPaths, sources: Object.keys(index).length });
