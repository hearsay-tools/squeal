#!/bin/sh
# Throwaway. In a scratch clone of Squeal (cwd), applies one sed edit to one source file,
# runs `npm run build`, lists the dist files whose bytes changed against dist0.sha, then
# restores the file and the dist. Usage: rebuild-diff.sh <label> <file> <sed-expr> <root>
set -eu
label=$1 file=$2 expr=$3 root=$4
sed -i "$expr" "$file"
git diff --stat -- "$file" | tail -1
npm run build >/dev/null 2>&1
find plugins -path '*/dist/*' -type f -exec sha256sum {} + | sort -k2 > "$root/dist.$label.sha"
changed=$(join -1 2 -2 2 -o 0,1.1,2.1 "$root/dist0.sha" "$root/dist.$label.sha" | awk '$2!=$3{print $1}')
echo "$label: $(echo "$changed" | grep -c . || true) of $(wc -l < "$root/dist0.sha") dist files changed"
echo "$changed" | sed 's|/dist/.*||' | sort | uniq -c
echo "$changed" > "$root/changed.$label.txt"
git checkout -q -- "$file" plugins
