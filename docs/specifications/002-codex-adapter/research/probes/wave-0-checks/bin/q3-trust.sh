#!/usr/bin/env bash
# Throwaway Q3: does a hash computed outside Codex match hooks/list, does trust written from it
# make the hooks trusted, and does that trust survive a plugin version bump (same hooks.json),
# and a hooks.json change? Everything under /tmp/w0c; CODEX_HOME is a scratch home.
set -e
B="$(cd "$(dirname "$0")" && pwd)"
export CODEX_HOME=$(bash "$B/home.sh" q3)
R=$(bash "$B/mkrepo.sh" q3 one)
W=$(bash "$B/mkrepo.sh" q3-work one)   # cwd for hooks/list
list() { AS_LOG=/tmp/w0c/logs/as-q3.log node "$B/as.mjs" hooks-list "$W" 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const h of JSON.parse(s).data[0].hooks) if(h.pluginId==="squeal-codex@squeal") console.log(h.key, h.currentHash, h.trustStatus, h.sourcePath.replace(process.env.CODEX_HOME,"$CODEX_HOME"))})'; }
step() { echo; echo "== $*"; }
cd /tmp
codex plugin marketplace add "$R" >/dev/null; codex plugin add squeal-codex@squeal | sed "s#$CODEX_HOME#\$CODEX_HOME#"
step "hooks/list after install (0.1.14)"; list | tee /tmp/w0c/logs/q3-list-0.txt
step "computed by hash.mjs from the source hooks.json"
node "$B/hash.mjs" "$R/plugins/codex/hooks/hooks.json" 'squeal-codex@squeal:hooks/hooks.json' | tee /tmp/w0c/logs/q3-computed.txt
step "diff listed vs computed (key + hash)"
diff <(awk '{print $1, $2}' /tmp/w0c/logs/q3-list-0.txt | sort) <(sort /tmp/w0c/logs/q3-computed.txt) && echo "all match"
step "write [hooks.state] from computed hashes into the scratch config.toml"
{ echo; echo '[hooks.state]'; while read -r k h; do printf '"%s" = { trusted_hash = "%s" }\n' "$k" "$h"; done < /tmp/w0c/logs/q3-computed.txt; } >> "$CODEX_HOME/config.toml"
list
step "bump version to 0.1.15, same hooks.json, codex plugin add again"
sed -i 's/"0.1.14"/"0.1.15"/' "$R/plugins/codex/.codex-plugin/plugin.json"
codex plugin add squeal-codex@squeal | sed "s#$CODEX_HOME#\$CODEX_HOME#"; ls "$CODEX_HOME/plugins/cache/squeal/squeal-codex"
list
step "change one hook command (PostToolUse), version 0.1.16"
sed -i 's/"0.1.15"/"0.1.16"/' "$R/plugins/codex/.codex-plugin/plugin.json"
sed -i 's/ PostToolUse"/ PostToolUse-v2"/' "$R/plugins/codex/hooks/hooks.json"
codex plugin add squeal-codex@squeal | sed "s#$CODEX_HOME#\$CODEX_HOME#"
list
step "recompute after the change"
node "$B/hash.mjs" "$R/plugins/codex/hooks/hooks.json" 'squeal-codex@squeal:hooks/hooks.json' | grep post_tool_use
