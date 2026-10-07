#!/usr/bin/env bash
# Throwaway Q3b: install the rich squeal-codex plugin into a scratch home, trust its hooks through
# app-server config/batchWrite, then run one codex exec with no bypass and no -c trust to see them fire.
set -e
B="$(cd "$(dirname "$0")" && pwd)"
export CODEX_HOME=$(bash "$B/home.sh" q3api); R=$(bash "$B/mkrepo.sh" q3api one)
codex plugin marketplace add "$R" >/dev/null; codex plugin add squeal-codex@squeal >/dev/null
node "$B/as-trust.mjs" "$R" squeal-codex@squeal
echo '$ sed -n /hooks.state/,+2p $CODEX_HOME/config.toml'; sed -n '/hooks.state/,+1p' "$CODEX_HOME/config.toml" | head -4
rm -f /tmp/w0c/logs/q3-api.jsonl; cd "$R"
W0C_LOG=/tmp/w0c/logs/q3-api.jsonl codex exec --json 'Run `true` with your shell tool once, then reply "ok".' </dev/null >/dev/null 2>&1
echo "hooks that ran:"; node -e 'for (const l of require("fs").readFileSync("/tmp/w0c/logs/q3-api.jsonl","utf8").trim().split("\n")) process.stdout.write(JSON.parse(l).label+" "); console.log()'
