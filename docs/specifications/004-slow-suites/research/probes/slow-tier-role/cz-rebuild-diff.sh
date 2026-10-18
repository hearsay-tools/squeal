#!/bin/sh
# Throwaway. In a scratch cezarion clone's packages/cezar (cwd), appends one exported
# constant to a source module, runs `npm run build`, and lists the dist files whose bytes
# changed against <root>/cz0.sha; then restores the module and rebuilds.
# Usage: cz-rebuild-diff.sh <label> <src file> <root>
set -eu
label=$1 file=$2 root=$3
printf '\nexport const probeMarker = "%s";\n' "$label" >> "$file"
npm run build >/dev/null 2>&1
find dist -type f -exec sha256sum {} + | sort -k2 > "$root/cz.$label.sha"
join -1 2 -2 2 -o 0,1.1,2.1 -a1 -a2 -e x "$root/cz0.sha" "$root/cz.$label.sha" | awk '$2!=$3{print $1}' > "$root/cz-changed.$label.txt"
echo "$label: $(wc -l < "$root/cz-changed.$label.txt") of $(wc -l < "$root/cz0.sha") dist files changed:"
cat "$root/cz-changed.$label.txt"
git checkout -q -- "$file" ../../packages/cezar/README.md 2>/dev/null || git checkout -q -- "$file"
npm run build >/dev/null 2>&1
