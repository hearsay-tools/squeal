#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as squeal-e2e, cwd the clone, with the
// clone's daemon stopped (the caller runs `squeal stop` first and `squeal start` after).
//   node verify.mjs <session log dir> <snap dir> <base commit>
// Checks each lint transition Squeal recorded during a session against a fresh ESLint CLI run on
// the same bytes. For a transition at revision N, every path the session's revisions changed is
// written as it was at N (the bytes come from the session's snapshots, or from git for base
// blobs), then `node node_modules/eslint/bin/eslint.js -f json` lints the transition's file.
// The previous state of the file is linted the same way at the revision of its previous
// transition (or the base). The claim (outcome, count, added, removed, as rule|message
// multisets) is compared with the CLI's. At the end every changed path gets its final bytes back
// and is checked against them. Writes verify.json in the session log dir.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const [logs, snap, base] = process.argv.slice(2);
const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)) : []);
const transitions = lines(`${logs}/transitions.jsonl`);
const revisions = lines(`${logs}/revisions.jsonl`).map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
const blobOf = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const bytesOf = (hash) => {
  if (hash === null || hash === undefined) return null;
  const kept = `${snap}/blobs/${hash}`;
  if (existsSync(kept)) return readFileSync(kept);
  try {
    return execFileSync("git", ["cat-file", "blob", hash], { maxBuffer: 1 << 28 });
  } catch {
    return undefined; // not captured
  }
};
const changed = [...new Set(revisions.flatMap((r) => r.changes.map((c) => c.path)))];
const final = new Map(changed.map((p) => [p, existsSync(p) ? readFileSync(p) : null]));
const baseBytes = (p) => {
  try {
    return execFileSync("git", ["show", `${base}:${p}`], { maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
};
const at = (n) => {
  const state = new Map(changed.map((p) => [p, { hash: "base" }]));
  for (const r of revisions) if (r.number <= n) for (const c of r.changes) state.set(c.path, { hash: c.newHash ?? null });
  return state;
};
const put = (p, bytes) => {
  if (bytes === null) rmSync(p, { force: true });
  else {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
};
const setTree = (n) => {
  const missing = [];
  for (const [p, s] of at(n)) {
    const bytes = s.hash === "base" ? baseBytes(p) : bytesOf(s.hash);
    if (bytes === undefined) missing.push(p);
    else put(p, bytes);
  }
  return missing;
};
const cli = (path) => {
  let out;
  try {
    out = execFileSync("node", ["node_modules/eslint/bin/eslint.js", "-f", "json", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
  } catch (e) {
    if (e.status !== 1) return { error: String(e.stderr ?? e).split("\n").slice(0, 4).join(" | ") };
    out = e.stdout;
  }
  const json = JSON.parse(out.slice(out.indexOf("[")));
  return { findings: (json[0]?.messages ?? []).map((m) => `${m.ruleId ?? ""}|${m.message}`).sort(), ignored: json.length === 0 };
};
const minus = (a, b) => {
  const left = [...b];
  const out = [];
  for (const x of a) {
    const i = left.indexOf(x);
    if (i >= 0) left.splice(i, 1);
    else out.push(x);
  }
  return out.sort();
};
const claim = (list) => JSON.parse(list).map((f) => `${f.rule ?? ""}|${f.message}`).sort();
const results = [];
const prevRev = new Map();
for (const t of transitions) {
  const before = prevRev.has(t.path) ? prevRev.get(t.path) : 0;
  const missingNow = setTree(t.revision);
  const now = cli(t.path);
  const missingBefore = setTree(before);
  const then = cli(t.path);
  const added = claim(t.added);
  const removed = claim(t.removed);
  const cliAdded = now.findings && then.findings ? minus(now.findings, then.findings) : null;
  const cliRemoved = now.findings && then.findings ? minus(then.findings, now.findings) : null;
  const kindOk =
    now.findings === undefined
      ? null
      : (t.kind.endsWith("pass") || t.kind === "fail-to-pass") === (now.findings.length === 0) || (t.kind === "resolved" && now.ignored);
  results.push({
    id: t.id,
    path: t.path,
    kind: t.kind,
    revision: t.revision,
    before,
    missing: [...missingNow, ...missingBefore],
    cliNow: now,
    cliBefore: then,
    claimAdded: added,
    claimRemoved: removed,
    cliAdded,
    cliRemoved,
    kindOk,
    addedOk: cliAdded === null ? null : JSON.stringify(cliAdded) === JSON.stringify(added),
    removedOk: cliRemoved === null ? null : JSON.stringify(cliRemoved) === JSON.stringify(removed),
  });
  prevRev.set(t.path, t.revision);
}
for (const [p, bytes] of final) put(p, bytes);
const restored = [...final].every(([p, b]) => (b === null ? !existsSync(p) : blobOf(readFileSync(p)) === blobOf(b)));
const finals = {};
for (const p of changed.filter((x) => /\.(ts|tsx|js|jsx|mjs|cjs|svelte)$/.test(x) && final.get(x) !== null)) finals[p] = cli(p);
writeFileSync(`${logs}/verify.json`, `${JSON.stringify({ restored, results, finals }, null, 2)}\n`);
for (const r of results)
  console.log(JSON.stringify({ id: r.id, path: r.path, kind: r.kind, rev: r.revision, kindOk: r.kindOk, addedOk: r.addedOk, removedOk: r.removedOk, now: r.cliNow.findings?.length ?? r.cliNow.error, missing: r.missing.length }));
console.log(JSON.stringify({ restored, finals: Object.fromEntries(Object.entries(finals).map(([p, v]) => [p, v.findings ?? v.error])) }));
