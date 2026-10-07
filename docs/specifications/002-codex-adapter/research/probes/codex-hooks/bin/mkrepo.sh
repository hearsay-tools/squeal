#!/usr/bin/env bash
# Throwaway: create a scratch git repository under /tmp/cxh/<name>.
set -e
d="/tmp/cxh/$1"; rm -rf "$d"; mkdir -p "$d"; cd "$d"
git init -q; printf 'export const add = (a, b) => a + b;\n' > a.js
printf '# scratch\n' > README.md; git add -A; git -c user.email=p@p -c user.name=p commit -qm init
echo "$d"
