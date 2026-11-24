#!/bin/sh
# Throwaway (026 agent37-sandboxes). Copies a small local file to /tmp on an instance via exec.
ID=$1; F=$2; D=$(cd "$(dirname "$0")" && pwd)
BODY=$(node -e 'console.log(JSON.stringify({command: `echo ${process.argv[1]} | base64 -d > /tmp/${process.argv[2]}`}))' "$(base64 -w0 < "$F")" "$(basename "$F")")
A37_PLANE=sandbox "$D/a37.sh" POST "/v1/instances/$ID/exec" "$BODY" 2>/dev/null >/dev/null
