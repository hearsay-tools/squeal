#!/usr/bin/env bash
# Throwaway: scratch git repository under /tmp/hpl/<name>.
set -e
d="/tmp/hpl/$1"; rm -rf "$d"; mkdir -p "$d"; cd "$d"
git init -q; printf 'export const add = (a, b) => a + b;\n' > a.js
git add -A; git -c user.email=p@p -c user.name=p commit -qm init
echo "$d"
