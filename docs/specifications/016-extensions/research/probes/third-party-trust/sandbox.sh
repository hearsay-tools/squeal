#!/usr/bin/env bash
# Throwaway probe for research 016-06 Q2/Q5: which unprivileged sandboxes this
# host allows. Scratch under /tmp with its own HOME; removed at the end.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
S=$(mktemp -d /tmp/tpt-sandbox.XXXXXX)
export HOME=$S/home TMPDIR=$S/tmp; mkdir -p "$HOME" "$TMPDIR" "$S/wt" "$S/secret"
echo "kernel $(uname -r); apparmor_restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)"
echo "== user namespace (what Bazel linux-sandbox and bwrap need)"
unshare --user --map-root-user --mount true 2>&1 && echo "userns: allowed" || echo "userns: refused"
echo "== Landlock read allow list"
gcc -O1 -o "$S/landlock" "$HERE/landlock.c"
echo inside > "$S/wt/in.txt"; echo secret > "$S/secret/out.txt"
"$S/landlock" "$S/wt" /bin/sh -c "cat $S/wt/in.txt; cat $S/secret/out.txt" 2>&1 | sed "s|$S|\$S|g"
rm -rf "$S"; test ! -e "$S" && echo "scratch removed"
