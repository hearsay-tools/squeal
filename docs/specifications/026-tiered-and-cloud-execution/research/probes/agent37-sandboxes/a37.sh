#!/bin/sh
# Throwaway (026 agent37-sandboxes). One Agent37 API call through the agent-vault proxy:
#   a37.sh <METHOD> <path> [json body]        (control plane, api.agent37.com)
#   A37_PLANE=sandbox a37.sh POST /v1/instances/<id>/exec '{"command":"..."}'
# Sends a placeholder key the proxy replaces on the wire; prints the body, then
# "HTTP <code> <seconds>" on stderr. Never reads or prints a credential.
M=$1; PATH_=$2; BODY=${3:-}
if [ "${A37_PLANE:-api}" = sandbox ]; then BASE=https://sandbox.agent37.app; H="X-Agent37-Key: placeholder"
else BASE=https://api.agent37.com; H="Authorization: Bearer placeholder"; fi
if [ -n "$BODY" ]; then
  curl -sS -X "$M" "$BASE$PATH_" -H "$H" -H "Content-Type: application/json" --data-binary "$BODY" -w '\n%{http_code} %{time_total}\n' --max-time 900
else
  curl -sS -X "$M" "$BASE$PATH_" -H "$H" -w '\n%{http_code} %{time_total}\n' --max-time 900
fi | awk 'NR>1{print prev} {prev=$0} END{print "HTTP " prev > "/dev/stderr"}'
