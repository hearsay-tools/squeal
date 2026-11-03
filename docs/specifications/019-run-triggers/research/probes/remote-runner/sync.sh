#!/usr/bin/env bash
# Throwaway (019-04): bytes and time to bring a working tree to a second directory per revision,
# by rsync (delta, as over SSH) and by a pushed git ref of the working tree. No network: both
# ends are on this host, so the times exclude any round trip.
# Usage: sync.sh <repo-to-clone> <work-dir> <commit-count>
set -euo pipefail
REPO=$1; W=$2; N=${3:-20}
rm -rf "$W"; mkdir -p "$W"
git clone -q --depth "$((N+5))" "file://$REPO" "$W/src"
cd "$W/src"
mapfile -t COMMITS < <(git rev-list --first-parent --reverse -n "$((N+1))" HEAD)
git checkout -q "${COMMITS[0]}"
ms() { date +%s%3N; }
RS=(rsync -a --delete --no-whole-file --exclude=.git/ --exclude=node_modules/ --stats)
sent() { awk '/Total bytes sent/ {gsub(",","",$4); print $4}'; }
# Initial sync, without node_modules and .git.
t=$(ms); b=$("${RS[@]}" ./ "$W/dst/" | sent); echo "rsync initial bytes=$b ms=$(( $(ms)-t ))"
echo "tree files=$(git ls-files | wc -l) bytes=$(git ls-files -z | xargs -0 -I{} sh -c 'test -f "{}" && cat "{}"' 2>/dev/null | wc -c)"
# git route: a bare "remote" and a checkout there.
git init -q --bare "$W/remote.git"
tree_commit() { local idx; idx=$(mktemp); cp .git/index "$idx"; GIT_INDEX_FILE=$idx git add -A; local tr; tr=$(GIT_INDEX_FILE=$idx git write-tree); rm -f "$idx"; echo "rev" | git commit-tree "$tr" ${1:+-p "$1"}; }
c=$(tree_commit); t=$(ms); git push -q "$W/remote.git" "$c:refs/squeal/rev"; pt=$(( $(ms)-t ))
pb=$(git rev-list --objects "$c" | git pack-objects --stdout -q | wc -c)
git clone -q "$W/remote.git" "$W/gdst" --no-checkout; t=$(ms); git -C "$W/gdst" fetch -q origin refs/squeal/rev && git -C "$W/gdst" checkout -q -f FETCH_HEAD; echo "git initial packbytes=$pb push_ms=$pt checkout_ms=$(( $(ms)-t ))"
prev=$c
# No-change rsync: the scan cost alone.
t=$(ms); b=$("${RS[@]}" ./ "$W/dst/" | sent); echo "rsync nochange bytes=$b ms=$(( $(ms)-t ))"
# One-line edit, as an agent's typical edit.
f=${EDIT_FILE:-$(git ls-files 'src/core/scheduler/*.ts' | head -1)}; echo "// probe edit" >> "$f"
t=$(ms); b=$("${RS[@]}" ./ "$W/dst/" | sent); echo "rsync oneline bytes=$b ms=$(( $(ms)-t ))"
t=$(ms); b=$(rsync -a --no-whole-file --stats --files-from=<(echo "$f") ./ "$W/dst/" | sent); echo "rsync oneline-filesfrom bytes=$b ms=$(( $(ms)-t ))"
c=$(tree_commit "$prev"); pb=$(printf "%s\n^%s\n" "$c" "$prev" | git pack-objects --revs --thin --stdout -q | wc -c)
t=$(ms); git push -q -f "$W/remote.git" "$c:refs/squeal/rev"; pt=$(( $(ms)-t ))
t=$(ms); git -C "$W/gdst" fetch -q origin refs/squeal/rev; ft=$(( $(ms)-t )); t=$(ms); git -C "$W/gdst" checkout -q -f FETCH_HEAD; echo "git oneline fetch_ms=$ft packbytes=$pb push_ms=$pt checkout_ms=$(( $(ms)-t ))"
git checkout -q -- "$f"; prev=$c
# Replay real commits as revisions.
for ((i=1; i<${#COMMITS[@]}; i++)); do
  git checkout -q "${COMMITS[$i]}"
  nfiles=$(git diff --name-only "${COMMITS[$((i-1))]}" "${COMMITS[$i]}" | wc -l)
  t=$(ms); b=$("${RS[@]}" ./ "$W/dst/" | sent); rt=$(( $(ms)-t ))
  c=$(tree_commit "$prev"); pb=$(printf "%s\n^%s\n" "$c" "$prev" | git pack-objects --revs --thin --stdout -q | wc -c)
  t=$(ms); git push -q -f "$W/remote.git" "$c:refs/squeal/rev"; pt=$(( $(ms)-t ))
  t=$(ms); git -C "$W/gdst" fetch -q origin refs/squeal/rev; ft=$(( $(ms)-t )); t=$(ms); git -C "$W/gdst" checkout -q -f FETCH_HEAD; ct=$(( $(ms)-t ))
  echo "commit ${COMMITS[$i]:0:9} files=$nfiles rsync_bytes=$b rsync_ms=$rt git_packbytes=$pb push_ms=$pt fetch_ms=$ft checkout_ms=$ct"
  prev=$c
done
