#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as squeal-e2e, cwd the clone.
//   node snap.mjs <out dir>
// Keeps every version of every file written in the clone during a session, so a lint line can
// later be checked against a fresh ESLint CLI run on the same bytes. It watches each folder that
// holds a tracked file (fs.watch, not recursive, so node_modules and .git are never watched) and
// each folder made later. On each event for a file it reads the bytes, computes the git blob
// SHA-1 (the hash Squeal keys a file by), keeps the bytes at <out>/blobs/<sha> and appends
// {t, path, blob} to <out>/log.jsonl; a path that is gone logs blob null. Stops on SIGTERM.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [out] = process.argv.slice(2);
mkdirSync(join(out, "blobs"), { recursive: true });
const log = join(out, "log.jsonl");
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
const dirs = new Set([""]);
for (const f of files) {
  let d = dirname(f);
  while (d !== "." && !dirs.has(d)) {
    dirs.add(d);
    d = dirname(d);
  }
}
const known = new Map();
const watchers = new Map();
const blobOf = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const skip = (rel) => /(^|\/)(node_modules|\.git|\.nx)(\/|$)/.test(rel);
const seen = (rel) => {
  if (skip(rel)) return;
  const abs = rel === "" ? "." : rel;
  let st;
  try {
    st = statSync(abs);
  } catch {
    if (known.get(rel) !== null) {
      known.set(rel, null);
      appendFileSync(log, `${JSON.stringify({ t: Date.now(), path: rel, blob: null })}\n`);
    }
    return;
  }
  if (st.isDirectory()) {
    add(rel);
    return;
  }
  if (!st.isFile()) return;
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch {
    return;
  }
  const blob = blobOf(bytes);
  if (known.get(rel) === blob) return;
  known.set(rel, blob);
  const keep = join(out, "blobs", blob);
  if (!existsSync(keep)) writeFileSync(keep, bytes);
  appendFileSync(log, `${JSON.stringify({ t: Date.now(), path: rel, blob })}\n`);
};
const add = (dir) => {
  if (watchers.has(dir) || skip(dir)) return;
  try {
    watchers.set(
      dir,
      watch(dir === "" ? "." : dir, (_event, name) => {
        if (name) seen(dir === "" ? String(name) : `${dir}/${name}`);
      }),
    );
  } catch {}
};
for (const d of dirs) add(d);
appendFileSync(log, `${JSON.stringify({ t: Date.now(), ready: watchers.size })}\n`);
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
setInterval(() => {}, 1 << 30);
