#!/usr/bin/env bash
# Does one node:test file signal its whole process group? Runs it as cezarion's
# test:unit project does (cwd packages/cezar, the config's argv), in a new session
# beside a canary `sleep` in the same group, and reports whether the canary and the
# runner's shell survived. A daemon spawns its node:test children in its own group,
# so a file that kills its group kills the daemon. Usage: bin/group-kill.sh <cezarion root> <test file>
root=$1 file=$2 tmp=$(mktemp -d)
setsid bash -c 'sleep 600 & echo $! > "$1/canary"; echo $$ > "$1/shell"; cd "$2/packages/cezar" && node --import ../../scripts/test-git-env.mjs --import tsx --test "$3" > "$1/out" 2>&1; echo "rc $?" > "$1/rc"' _ "$tmp" "$root" "$file" &
wait $!
sleep 1
canary=$(cat "$tmp/canary"); shell=$(cat "$tmp/shell")
echo "$file: runner $(cat "$tmp/rc" 2>/dev/null || echo 'rc none (the shell was killed)'); canary $canary $(kill -0 "$canary" 2>/dev/null && echo alive || echo gone); $(grep -E "^. (pass|fail) " "$tmp/out" | tr "\n" " ")"
kill "$canary" 2>/dev/null; rm -rf "$tmp"
