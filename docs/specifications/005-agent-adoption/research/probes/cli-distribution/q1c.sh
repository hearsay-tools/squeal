#!/usr/bin/env bash
# Throwaway probe (005-05, question 1). After q1.sh and q3.sh: hooks trusted at 0.1.72 in the scratch
# Codex home; the hub pin moves to a 0.1.73 build (0.1.72 with only the version changed), Codex upgrades,
# and the trust step reports what Codex now says of the hooks. Usage: q1c.sh <q1 scratch> <fixture>
set -u
S=$(cd "$1" && pwd); G=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
export HOME=$S/home CODEX_HOME=$S/home/.codex
unset $(env | grep -oE '^(CLAUDE|CEZ_)[A-Z_]*' ) 2>/dev/null
cd "$S/tool"; for p in claude-code/.claude-plugin codex/.codex-plugin; do sed -i 's/"0.1.72"/"0.1.73"/' plugins/$p/plugin.json; done
git commit -qam 0.1.73; git tag squeal--v0.1.73; git push -q origin main --tags; V=$(git rev-parse HEAD)
cd "$S/hub"; sed -i "s/squeal--v0.1.72/squeal--v0.1.73/; s/\"sha\":\"[0-9a-f]*\"/\"sha\":\"$V\"/" .claude-plugin/marketplace.json .agents/plugins/marketplace.json
git commit -qam "pin 0.1.73"; git push -q origin HEAD:main
node "$HERE/git-http.mjs" "$S/srv" 8791 > "$S/http2.log" 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
codex plugin marketplace upgrade hearsay 2>&1 | grep -v WARNING | head -1; ls "$CODEX_HOME/plugins/cache/hearsay/squeal/"
cd "$G"; node --disable-warning=ExperimentalWarning "$CODEX_HOME/plugins/cache/hearsay/squeal/0.1.73/dist/cli/squeal.mjs" init --harness codex --trust < /dev/null 2>&1 | grep -E "trusted|modified|untrusted|nothing" | head -4
