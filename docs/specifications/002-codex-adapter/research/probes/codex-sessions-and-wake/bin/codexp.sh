#!/bin/sh
# Throwaway: run codex for a scratch repo with Cezar credentials removed from the environment,
# the scratch project trusted through -c, and repo hooks run without persisted trust.
# Usage: codexp.sh <repo> <codex args...>
R=$1; shift
exec env -u CEZ_DELEGATION_TOKEN -u CEZ_TOOL_TOKEN -u CEZ_TOOL_SOCKET -u CEZ_DELEGATION_URL \
  codex -c "projects.\"$R\".trust_level=\"trusted\"" -c 'plugins."superpowers@apptension-dev".enabled=false' \
  -c 'plugins."apptension-sdlc@apptension-dev".enabled=false' -c 'plugins."apptension-review@apptension-dev".enabled=false' \
  --dangerously-bypass-hook-trust "$@"
