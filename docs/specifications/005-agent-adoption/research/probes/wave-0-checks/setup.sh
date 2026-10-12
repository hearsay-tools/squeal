#!/bin/sh
# Throwaway (005-04). Builds, under $W only: a tool repository holding plugins/ at
# squeal--v0.1.131 (tag v131) and at this worktree's HEAD (tag v132); a hub "hearsay"
# whose entries pin one of them (git-subdir, file:// URL); fixture repositories; and the
# scratch Codex config (provider fields copied from the real config.toml, read only;
# the key stays an environment variable).
set -eu
MODE=${1:-all} PIN=${2:-}
REPO=$(git rev-parse --show-toplevel)
. "$(dirname "$0")/env.sh"
T=$W/toolrepo
if [ "$MODE" != hub ]; then
rm -rf "$T" && mkdir -p "$T" && git -C "$T" init -q -b main
for pair in "squeal--v0.1.131 v131" "HEAD v132"; do
  set -- $pair
  rm -rf "$T/plugins" && git -C "$REPO" archive "$1" plugins | tar -x -C "$T"
  git -C "$T" add -A && git -C "$T" commit -qm "$2" && git -C "$T" tag "$2"
done
echo "tool repo: $(git -C "$T" log --oneline | tr '\n' ' ')"
for v in v131 v132; do git -C "$T" show "$v:plugins/claude-code/.claude-plugin/plugin.json" | grep '"version"'; done
fi
hub() { # $1 = tag
  H=$W/hub; mkdir -p "$H/.claude-plugin" "$H/.agents/plugins"
  sha=$(git -C "$T" rev-list -n1 "$1")
  for h in claude-code codex; do
    f=$H/.claude-plugin/marketplace.json; [ $h = codex ] && f=$H/.agents/plugins/marketplace.json
    cat > "$f" <<J
{ "name": "hearsay", "owner": { "name": "probe" },
  "plugins": [ { "name": "squeal", "description": "probe pin $1",
    "source": { "source": "git-subdir", "url": "file://$T", "path": "plugins/$h", "ref": "$1", "sha": "$sha" } } ] }
J
  done
  [ -d "$H/.git" ] || git -C "$H" init -q -b main
  git -C "$H" add -A && git -C "$H" commit -qm "pin $1" || true
}
[ "$MODE" = hub ] && { hub "$PIN"; echo "hub pinned to $PIN"; exit 0; }
hub v131
# fixtures: a plain repository with no Squeal anything, and one that enables Squeal in project settings
for f in plain enabled; do
  F=$W/fx/$f; rm -rf "$F"; mkdir -p "$F/src"
  printf 'export const add = (a, b) => a + b;\n' > "$F/src/add.js"
  printf '{ "name": "fx-%s", "private": true, "type": "module" }\n' "$f" > "$F/package.json"
  git -C "$F" init -q -b main
done
mkdir -p "$W/fx/enabled/.claude"
printf '{\n  "enabledPlugins": { "squeal@hearsay": true }\n}\n' > "$W/fx/enabled/.claude/settings.json"
for f in plain enabled; do git -C "$W/fx/$f" add -A && git -C "$W/fx/$f" commit -qm init; done
# scratch Codex config: model provider fields that hold no credential
REAL=/home/agent/.codex/config.toml
prov=$(sed -n 's/^model_provider *= *"\(.*\)"/\1/p' "$REAL" | head -1)
awk -v h="[model_providers.$prov]" '$0==h{p=1;print;next} /^\[/{p=0} p && /^(name|base_url|env_key|wire_api|requires_openai_auth|supports_websockets) *=/' "$REAL" > "$W/provider.toml"
{ echo "model_provider = \"$prov\""; echo 'model = "gpt-6-luna"'; echo 'approval_policy = "never"'; echo 'sandbox_mode = "danger-full-access"'; echo 'check_for_update_on_startup = false'; echo; cat "$W/provider.toml"; } > "$CODEX_HOME/config.toml"
echo "setup done, load $(load)"
