#!/bin/sh
# Throwaway (026 agent37-sandboxes). Prints /tmp/<log> from each instance id given.
D=$(cd "$(dirname "$0")" && pwd); LOG=$1; shift
for id in "$@"; do echo "== $id"; A37_PLANE=sandbox "$D/a37.sh" POST /v1/instances/$id/exec "{\"command\":\"cat /tmp/$LOG\"}" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).stdout'; done
