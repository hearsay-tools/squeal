#!/usr/bin/env bash
# Throwaway probe (005-05, question 1). After q1c.sh: user scope holds 0.1.72, the hub pins 0.1.73.
# A project-scope install in proj2 takes 0.1.73; what `claude plugin list` reports in each directory.
set -u
S=$(cd "$1" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
export HOME=$S/home CODEX_HOME=$S/home/.codex DISABLE_AUTOUPDATER=1
unset $(env | grep -oE '^(CLAUDE|CEZ_)[A-Z_]*' ) 2>/dev/null
node "$HERE/git-http.mjs" "$S/srv" 8791 > "$S/http3.log" 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
claude plugin marketplace update hearsay 2>&1 | tail -1
mkdir -p "$S/proj2"; git -C "$S/proj2" init -q
(cd "$S/proj2" && claude plugin install squeal@hearsay --scope project 2>&1 | tail -1)
for d in proj2 other; do echo "--- claude plugin list --json in $d"; (cd "$S/$d" && claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))if(String(p.id).startsWith("squeal@"))console.log("  ",p.id,p.scope,p.version,p.enabled,p.installPath??"")})'); done
