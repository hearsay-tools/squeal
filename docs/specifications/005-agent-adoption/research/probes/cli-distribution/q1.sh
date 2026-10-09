#!/usr/bin/env bash
# Throwaway probe (005-05, question 1). Scratch HOME and CODEX_HOME under $1; never the real ones.
# A local hub "hearsay" pins the real Squeal plugins of release 0.1.62 and of this commit (0.1.72),
# served over smart HTTP on 127.0.0.1. Usage: q1.sh <scratch dir> <pin dir holding v62/ and v72/>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
export HOME=$S/home CODEX_HOME=$S/home/.codex DISABLE_AUTOUPDATER=1
unset $(env | grep -oE '^(CLAUDE|CEZ_)[A-Z_]*' ) 2>/dev/null
mkdir -p "$CODEX_HOME" "$S/srv"; cd "$S"
git config --global user.email probe@example.com; git config --global user.name probe; git config --global init.defaultBranch main
step(){ echo; echo "### $*"; }
cx(){ codex "$@" 2>&1 | grep -v '^WARNING'; }
ver(){ echo "  shim (resolving) in $(basename "$PWD"): $("$HERE/squeal-shim.sh" --version 2>&1 | tail -1)"; }
fixed(){ echo "  fixed path $1: $(node "$1" --version 2>&1 | grep -E '^[0-9]|Error' | head -1)"; }
ipj(){ node -e 'const d=require(process.argv[1]).plugins["squeal@hearsay"]??[];for(const e of d)console.log("  ",e.scope,e.projectPath??"",e.version)' "$HOME/.claude/plugins/installed_plugins.json"; }

mkdir tool && cd tool && git init -q && mkdir plugins
for v in 62 72; do rm -rf plugins/*; cp -r "$PIN/v$v/plugins/claude-code" "$PIN/v$v/plugins/codex" plugins/
  git add -A; git commit -qm "0.1.$v"; git tag squeal--v0.1.$v; done
V62=$(git rev-parse squeal--v0.1.62); V72=$(git rev-parse squeal--v0.1.72); cd "$S"
mkdir hub && cd hub && git init -q && mkdir -p .claude-plugin .agents/plugins
pin(){ for f in claude-code:.claude-plugin codex:.agents/plugins; do p=${f%%:*}; d=${f#*:}
  echo "{\"name\":\"hearsay\",\"owner\":{\"name\":\"p\"},\"plugins\":[{\"name\":\"squeal\",\"source\":{\"source\":\"git-subdir\",\"url\":\"http://127.0.0.1:8791/tool.git\",\"path\":\"plugins/$p\",\"ref\":\"$1\",\"sha\":\"$2\"}}]}" > $d/marketplace.json; done
  git add -A; git commit -qm "pin $1"; git push -q origin HEAD:main 2>/dev/null || true; }
cd "$S"; for r in tool hub; do git init -q --bare srv/$r.git; git -C $r remote add origin "$S/srv/$r.git"; done
git -C tool push -q origin main --tags; (cd hub; pin squeal--v0.1.62 "$V62")
node "$HERE/git-http.mjs" "$S/srv" 8791 > http.log 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
mkdir -p proj other; git -C proj init -q

step "install 0.1.62: Claude Code user scope, Codex"
claude plugin marketplace add http://127.0.0.1:8791/hub.git 2>&1 | tail -1
claude plugin install squeal@hearsay 2>&1 | tail -1
cx plugin marketplace add http://127.0.0.1:8791/hub.git | head -1
cx plugin add squeal@hearsay | tail -1
CC62=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.62/dist/cli/squeal.mjs
CX62=$CODEX_HOME/plugins/cache/hearsay/squeal/0.1.62/dist/cli/squeal.mjs
ipj; (cd proj; ver); fixed "$CC62"; fixed "$CX62"
echo "  shim cost, 10 calls: $( { time (for i in 1 2 3 4 5 6 7 8 9 10; do "$HERE/squeal-shim.sh" --version >/dev/null; done) ; } 2>&1 | grep real)"
echo "  direct cost, 10 calls: $( { time (for i in 1 2 3 4 5 6 7 8 9 10; do node "$CC62" --version >/dev/null; done) ; } 2>&1 | grep real)  load $(cut -d' ' -f1 /proc/loadavg)"

step "hub pin moves to 0.1.72; Claude Code marketplace update; project-scope install in proj"
(cd hub; pin squeal--v0.1.72 "$V72")
claude plugin marketplace update hearsay 2>&1 | tail -1
(cd proj && claude plugin install squeal@hearsay --scope project 2>&1 | tail -1; echo "  proj/.claude/settings.json: $(tr -d ' \n' < .claude/settings.json)")
ipj; ls "$HOME/.claude/plugins/cache/hearsay/squeal/"
(cd proj; ver); (cd other; ver)

step "Claude Code: user-scope update to 0.1.72"
claude plugin update squeal@hearsay --scope user 2>&1 | tail -1
ipj; echo "  0.1.62 dir: $(ls -a "$HOME/.claude/plugins/cache/hearsay/squeal/0.1.62" | tr '\n' ' ')"
(cd other; ver); fixed "$CC62"

step "Codex: before upgrade, then marketplace upgrade"
cx plugin list | grep squeal@
cx plugin marketplace upgrade hearsay | head -2
ls "$CODEX_HOME/plugins/cache/hearsay/squeal/"; fixed "$CX62"
rm -rf "$HOME/.claude/plugins/installed_plugins.json.hide"; mv "$HOME/.claude/plugins/installed_plugins.json" "$HOME/.claude/plugins/installed_plugins.json.hide"
(cd other; echo "  (Claude Code record hidden, so the shim falls to Codex)"; ver)
mv "$HOME/.claude/plugins/installed_plugins.json.hide" "$HOME/.claude/plugins/installed_plugins.json"
step "auto-update settings as written"
cat "$HOME/.claude/plugins/known_marketplaces.json" | tr -d '\n ' | head -c 400; echo
grep -A3 'marketplaces' "$CODEX_HOME/config.toml"
