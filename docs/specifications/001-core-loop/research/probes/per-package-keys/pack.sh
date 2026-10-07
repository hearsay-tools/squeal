#!/bin/sh
# Packs every fixture package under pkgsrc/ into fixture/tarballs/ so npm installs copies, not links.
set -e
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$here/fixture/tarballs"
for d in "$here"/pkgsrc/*/; do (cd "$d" && npm pack --silent --pack-destination "$here/fixture/tarballs" >/dev/null); done
ls "$here/fixture/tarballs"
