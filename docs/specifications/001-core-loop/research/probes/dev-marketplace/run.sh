#!/usr/bin/env bash
# 001-164 probe: rename an added git marketplace's manifest name; scratch HOME/CODEX_HOME only.
set -u
S=$(cd "$1" && pwd); HTTP=$(cd "$(dirname "$0")/../release-hub" && pwd)/git-http.mjs
export HOME=$S/home CODEX_HOME=$S/home/.codex
mkdir -p "$CODEX_HOME" "$S/srv"; cd "$S"
git config --global user.email p@example.com; git config --global user.name p; git config --global init.defaultBranch main
step(){ echo; echo "### $*"; }
cx(){ codex "$@" 2>&1 | grep -v '^WARNING'; }
mkdir tool && cd tool && git init -q
mkdir -p plugins/claude-code/.claude-plugin plugins/codex/.codex-plugin .claude-plugin .agents/plugins plugins/claude-code/skills/hello plugins/codex/skills/hello
w(){ for h in claude-code/.claude-plugin codex/.codex-plugin; do echo "{\"name\":\"tool\",\"version\":\"$1\",\"description\":\"probe\"}" > plugins/$h/plugin.json; done
  printf -- "---\nname: hello\ndescription: hello\n---\nhello\n" > plugins/claude-code/skills/hello/SKILL.md; cp plugins/claude-code/skills/hello/SKILL.md plugins/codex/skills/hello/
  echo "{\"name\":\"$2\",\"owner\":{\"name\":\"p\"},\"plugins\":[{\"name\":\"tool\",\"source\":\"./plugins/claude-code\"}]}" > .claude-plugin/marketplace.json
  echo "{\"name\":\"$2\",\"plugins\":[{\"name\":\"tool\",\"source\":\"./plugins/codex\"}]}" > .agents/plugins/marketplace.json; }
w 0.1.0 tool; git add -A; git commit -qm 0.1.0; cd "$S"
git clone -q --bare tool srv/tool.git; git -C tool remote add origin "$S/srv/tool.git"
node "$HTTP" "$S/srv" 8766 > http.log 2>&1 & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
step "install tool@tool from marketplace tool, both harnesses"
claude plugin marketplace add http://127.0.0.1:8766/tool.git 2>&1 | tail -1
claude plugin install tool@tool 2>&1 | tail -1
cx plugin marketplace add http://127.0.0.1:8766/tool.git | head -1
cx plugin add tool@tool | tail -1
step "rename manifests to tool-dev, version 0.1.1, push"
cd tool; w 0.1.1 tool-dev; git commit -qam rename; git push -q origin main; cd "$S"
step "claude marketplace update tool"
claude plugin marketplace update tool 2>&1 | tail -3
claude plugin marketplace list 2>&1 | tail -6
claude plugin list 2>&1 | tail -6
step "claude plugin update tool@tool"
claude plugin update tool@tool 2>&1 | tail -2
ls home/.claude/plugins/cache/ 2>&1; ls home/.claude/plugins/cache/*/tool 2>&1
step "codex plugin list before upgrade"
cx plugin list | grep -i tool
step "codex marketplace upgrade tool"
cx plugin marketplace upgrade tool | head -3
cx plugin marketplace list 2>&1 | head -5
cx plugin list | grep -i tool
ls home/.codex/plugins/cache/ 2>&1; ls home/.codex/plugins/cache/*/tool 2>&1
grep -n "tool" home/.codex/config.toml
