#!/usr/bin/env bash
# Throwaway probe (001-163, release-hub). Scratch HOME and CODEX_HOME under $1; never the real ones.
# Needs claude (2.1.295) and codex (0.160.1) on PATH, git, node. Usage: run.sh <empty scratch dir>
set -u
S=$(cd "$1" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
export HOME=$S/home CODEX_HOME=$S/home/.codex CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=
mkdir -p "$CODEX_HOME" "$S/srv"; cd "$S"
git config --global user.email probe@example.com; git config --global user.name probe; git config --global init.defaultBranch main
step(){ echo; echo "### $*"; }
cx(){ codex "$@" 2>&1 | grep -v '^WARNING'; }

# A tool repo shaped like squeal: plugins/claude-code and plugins/codex, one version for both.
mkdir tool && cd tool && git init -q
mkdir -p plugins/claude-code/.claude-plugin plugins/claude-code/skills/hello plugins/codex/.codex-plugin plugins/codex/skills/hello
w(){ for h in claude-code/.claude-plugin codex/.codex-plugin; do echo "{\"name\":\"tool\",\"version\":\"$1\",\"description\":\"probe\"}" > plugins/$h/plugin.json; done
  printf -- "---\nname: hello\ndescription: hello\n---\nhello\n" > plugins/claude-code/skills/hello/SKILL.md; cp plugins/claude-code/skills/hello/SKILL.md plugins/codex/skills/hello/
  echo "$2" > plugins/claude-code/CONTENT; echo "$2" > plugins/codex/CONTENT; }
mkdir -p .claude-plugin .agents/plugins
echo '{"name":"tool","owner":{"name":"p"},"plugins":[{"name":"tool","source":"./plugins/claude-code"}]}' > .claude-plugin/marketplace.json
echo '{"name":"tool","plugins":[{"name":"tool","source":"./plugins/codex"}]}' > .agents/plugins/marketplace.json
w 0.1.0 a; git add -A; git commit -qm 0.1.0; git tag tool--v0.1.0
w 0.1.1 b; git commit -qam 0.1.1; git tag tool--v0.1.1
w 0.1.2 c; git commit -qam "0.1.2 on main, never released"
V0=$(git rev-parse tool--v0.1.0); V1=$(git rev-parse tool--v0.1.1); cd "$S"

# The hub: one marketplace file per harness, entries pinned by ref and sha.
mkdir hub && cd hub && git init -q && mkdir -p .claude-plugin .agents/plugins
pin(){ # pin <ref> <sha>
  echo "{\"name\":\"probe-hub\",\"owner\":{\"name\":\"p\"},\"description\":\"probe\",\"plugins\":[{\"name\":\"tool\",\"source\":{\"source\":\"git-subdir\",\"url\":\"http://127.0.0.1:8765/tool.git\",\"path\":\"plugins/claude-code\",\"ref\":\"$1\",\"sha\":\"$2\"}}]}" > .claude-plugin/marketplace.json
  echo "{\"name\":\"probe-hub\",\"plugins\":[{\"name\":\"tool\",\"source\":{\"source\":\"git-subdir\",\"url\":\"http://127.0.0.1:8765/tool.git\",\"path\":\"plugins/codex\",\"ref\":\"$1\",\"sha\":\"$2\"}}]}" > .agents/plugins/marketplace.json
  git add -A; git commit -qm "pin $1"; git push -q origin HEAD:main 2>/dev/null || true; }
cd "$S"
for r in tool hub; do git clone -q --bare $r srv/$r.git 2>/dev/null || git init -q --bare srv/$r.git; git -C $r remote add origin "$S/srv/$r.git"; done
git -C tool push -q origin main --tags
cd hub; pin tool--v0.1.0 "$V0"; cd "$S"
node "$HERE/git-http.mjs" "$S/srv" 8765 > http.log 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1

step "Q1 claude validate + add + install pinned"
claude plugin validate hub | tail -1
claude plugin marketplace add http://127.0.0.1:8765/hub.git 2>&1 | tail -1
claude plugin install tool@probe-hub 2>&1 | tail -1
ls home/.claude/plugins/cache/probe-hub/tool/; cat home/.claude/plugins/cache/probe-hub/tool/*/CONTENT
step "Q2 codex add + install pinned"
cx plugin marketplace add http://127.0.0.1:8765/hub.git | head -1
cx plugin list | grep tool@
cx plugin add tool@probe-hub | tail -1

step "pin moves to 0.1.1 in the hub"
cd hub; pin tool--v0.1.1 "$V1"; cd "$S"
step "Q1 claude plugin update without marketplace update"
claude plugin update tool@probe-hub 2>&1 | tail -1
step "Q1 claude marketplace update, then plugin update"
claude plugin marketplace update probe-hub 2>&1 | tail -1
claude plugin update tool@probe-hub 2>&1 | tail -1
ls -a home/.claude/plugins/cache/probe-hub/tool/0.1.0/ | tr '\n' ' '; echo
step "Q2 codex plugin list without upgrade"
cx plugin list | grep tool@
step "Q2 codex marketplace upgrade"
cx plugin marketplace upgrade probe-hub | head -1
ls home/.codex/plugins/cache/probe-hub/tool/

step "tool main moves; hub does not"
cd tool; w 0.1.3 d; git commit -qam 0.1.3; git push -q origin main; cd "$S"
claude plugin marketplace update probe-hub 2>&1 | tail -1; claude plugin update tool@probe-hub 2>&1 | tail -1
cx plugin marketplace upgrade probe-hub | head -1; ls home/.codex/plugins/cache/probe-hub/tool/

step "Q4 pin moves to new content with the version unchanged (0.1.1)"
cd tool; w 0.1.1 e; git commit -qam "0.1.1 again, new content"; git tag tool--v0.1.1b; git push -q origin main --tags; V1B=$(git rev-parse HEAD); cd "$S"
cd hub; pin tool--v0.1.1b "$V1B"; cd "$S"
claude plugin marketplace update probe-hub 2>&1 | tail -1; claude plugin update tool@probe-hub 2>&1 | tail -1
echo "claude content: $(cat home/.claude/plugins/cache/probe-hub/tool/0.1.1/CONTENT)"
cx plugin marketplace upgrade probe-hub | head -1
echo "codex content: $(cat home/.codex/plugins/cache/probe-hub/tool/0.1.1/CONTENT)"

step "Q5 migration: per-repo marketplace (like squeal@squeal), then removed"
claude plugin marketplace add http://127.0.0.1:8765/tool.git 2>&1 | tail -1
claude plugin install tool@tool 2>&1 | tail -1
claude plugin marketplace remove tool 2>&1 | head -2
echo "claude old cache after remove: $(ls -a home/.claude/plugins/cache/tool/tool/* | tr '\n' ' ')"
cx plugin marketplace add http://127.0.0.1:8765/tool.git | head -1
cx plugin add tool@tool | tail -1
cx plugin remove tool@tool
echo "codex old cache after remove: [$(ls home/.codex/plugins/cache/tool/ 2>&1)]"
step "Q4 claude plugin tag dry run"
(cd tool && claude plugin tag plugins/claude-code --dry-run 2>&1 | grep -v "^⚠" | head -3)
