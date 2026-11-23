#!/bin/sh
# Throwaway (026 boat-sandboxes). Prints, as a JSON array, the ssh arguments `boat ssh <id>`
# uses (key, pinned host key file, alias, endpoint), plus a ControlMaster socket, so a
# driver can keep one connection. Captured from the process list while `boat ssh` runs.
ID=$1
boat ssh "$ID" -- sleep 4 >/dev/null 2>&1 &
sleep 2
ARGS=$(ps -eo args | grep "^ssh -p .*BatchMode=yes" | grep "sleep 4" | head -1 | sed 's/ sleep 4$//; s/^ssh //')
wait
node -e '
const a = process.argv[1].split(" ").filter(Boolean);
const sock = `/tmp/sq026-cm-${process.argv[2]}`;
console.log(JSON.stringify(["-o", "ControlMaster=auto", "-o", `ControlPath=${sock}`, "-o", "ControlPersist=900", ...a]));
' -- "$ARGS" "$ID"
