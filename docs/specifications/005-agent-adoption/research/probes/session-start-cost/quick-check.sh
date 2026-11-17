#!/bin/sh
# Throwaway. Per store copy: evict, whole quick_check (cold); whole again (warm); then each
# table alone (warm). Usage: quick-check.sh <scratch> <repo>...
S=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
for r in "$@"; do
  db=$S/$r/squeal/store.sqlite
  python3 -I "$here/evict.py" "$db" --evict
  nice node "$here/quick-check.mjs" "$db"
  python3 -I "$here/evict.py" "$db"
  nice node "$here/quick-check.mjs" "$db"
  for t in $(node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("SELECT name FROM sqlite_master WHERE type=\x27table\x27 AND name NOT LIKE \x27sqlite_%\x27").all().map(r=>r.name).join(" "))' "$db"); do
    nice node "$here/quick-check.mjs" "$db" "$t"
  done
done
