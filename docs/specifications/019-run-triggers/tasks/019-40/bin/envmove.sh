#!/bin/sh
# Throwaway probe for 019-40, as squeal-e2e in the cezarion clone (019-17's as-e2e.mjs). No model.
#   sh envmove.sh <cez-groups commit>
# Why did s1c and s1c-2 re-key every lint file (lint-keying seq 2, mode `config`, at revision 1)
# at their first commit on a new store, while a second commit kept the keying? s1c's state: a new
# store, a daemon settled by `squeal status --wait 90000`, an edit of
# packages/contract/src/effort.ts, a commit of it. After the settle, after the edit and after the
# commit's pass, the lint keying, cursor and keyed inputs (lint.sqlite meta) are saved to
# $TMPDIR/envmove-<stage>.json, and each stage's inputs are compared with the first.
set -eu
base=$1
git checkout -q -f cez-groups && git reset -q --hard "$base" && git clean -fdq
squeal stop >/dev/null 2>&1 || true
rm -rf .git/squeal
squeal start >/dev/null
squeal status --wait 90000 >/dev/null 2>&1 || true
snap() {
  node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(".git/squeal/lint.sqlite", { readOnly: true });
const out = {};
for (const r of db.prepare("SELECT key, value FROM meta WHERE key LIKE ? OR key LIKE ? OR key LIKE ?").all("lint-keying%", "lint-cursor%", "lint-inputs%")) out[r.key.split(":")[0]] = JSON.parse(r.value);
require("fs").writeFileSync(process.argv[1], JSON.stringify(out));
const k = out["lint-keying"] ?? {};
console.log(process.argv[2], "keying", k.seq, k.mode, "rev", k.revision, "cursor", JSON.stringify(out["lint-cursor"]), "inputs", out["lint-inputs"]?.files?.length, "installed", out["lint-inputs"]?.installed);
' "$TMPDIR/envmove-$1.json" "$1"
}
snap settled
printf '\nfunction isEffortLevel(value: string): boolean {\n  return value.length > 0;\n}\n' >> packages/contract/src/effort.ts
sleep 6
snap edited
git add packages/contract/src/effort.ts && git commit -q -m "probe 019-40: envmove"
squeal status --wait 2000 >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  sleep 1
  seq=$(node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".git/squeal/lint.sqlite", { readOnly: true }); const r = db.prepare("SELECT value FROM meta WHERE key LIKE ?").get("lint-keying%"); console.log(r ? JSON.parse(r.value).seq : 0)')
  [ "$seq" -ge 2 ] && break
done
echo "waited ${i} s after the commit"
snap committed
node -e '
const fs = require("fs");
const read = (s) => JSON.parse(fs.readFileSync(`${process.env.TMPDIR}/envmove-${s}.json`, "utf8"))["lint-inputs"] ?? { files: [] };
const a = read("settled");
for (const s of ["edited", "committed"]) {
  const b = read(s);
  const m = new Map(a.files);
  const n = new Map(b.files);
  const diff = [...new Set([...m.keys(), ...n.keys()])].filter((p) => m.get(p) !== n.get(p)).map((p) => `${p}: ${m.get(p) ?? "absent"} -> ${n.get(p) ?? "absent"}`);
  console.log(s, "environment", a.environment === b.environment ? "same" : "moved", "installed", a.installed, "->", b.installed, "input blobs differing:", diff.length ? diff.join("; ") : "none");
}
'
squeal stop >/dev/null 2>&1 || true
git checkout -q -f cez-groups && git reset -q --hard "$base" && git clean -fdq
