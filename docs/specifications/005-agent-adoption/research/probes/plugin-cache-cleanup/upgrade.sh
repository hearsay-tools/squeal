#!/bin/sh
# Throwaway probe (005-72): one plugin upgrade in Codex and in Claude Code.
# Run only as squeal-e2e, fed on stdin, cwd /:
#   sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... sh -s < upgrade.sh
# The plugin holds a manifest and one SKILL.md: no hooks, no code.
set -eu
T="$HOME/probe-005-72-$(date +%s)"
mkdir -p "$T/mkt/plugins/probe/.codex-plugin" "$T/mkt/plugins/probe/.claude-plugin" \
  "$T/mkt/plugins/probe/skills/probe" "$T/mkt/.agents/plugins" "$T/mkt/.claude-plugin"
cd "$T/mkt"
printf '{"name":"probe","plugins":[{"name":"probe","source":"./plugins/probe","description":"probe"}]}\n' > .agents/plugins/marketplace.json
printf '{"name":"probe","owner":{"name":"probe"},"plugins":[{"name":"probe","source":"./plugins/probe","description":"probe"}]}\n' > .claude-plugin/marketplace.json
printf -- '---\nname: probe\ndescription: probe skill\n---\nprobe\n' > plugins/probe/skills/probe/SKILL.md
version() {
  printf '{"name":"probe","version":"%s","description":"probe"}\n' "$1" > plugins/probe/.codex-plugin/plugin.json
  printf '{"name":"probe","version":"%s","description":"probe"}\n' "$1" > plugins/probe/.claude-plugin/plugin.json
}
git init -q -b main .
# Codex upgrades only git marketplaces, and takes only http(s), ssh or owner/repo
# sources, so a bare copy is served over dumb HTTP on localhost.
commit() {
  git add -A; git -c user.name=p -c user.email=p@p commit -qm "$1"
  git push -q "$T/mkt.git" main 2>/dev/null || { git clone -q --bare . "$T/mkt.git"; }
  git --git-dir="$T/mkt.git" update-server-info
}
version 1.0.0; commit v1.0.0
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
CX="$HOME/.codex/plugins/cache/probe/probe"
CC="$HOME/.claude/plugins/cache/probe/probe"
show() { echo "-- $1"; for d in "$CX" "$CC"; do [ -d "$d" ] && for v in "$d"/*; do echo "$v inode=$(stat -c %i "$v") $(ls -A "$v" | tr '\n' ' ')"; done; done; :; }

echo "== codex $(codex --version)"
codex plugin marketplace add "http://127.0.0.1:$PORT/mkt.git" 2>&1 | tail -3
codex plugin add probe@probe 2>&1 | tail -3
show "codex after install 1.0.0"
OLD_SKILL="$CX/1.0.0/skills/probe/SKILL.md"
exec 9<"$OLD_SKILL"   # an open handle, as a process that read the file
version 1.0.1; commit v1.0.1
codex plugin marketplace upgrade probe 2>&1 | tail -3
show "codex after marketplace upgrade to 1.0.1"
[ -e "$OLD_SKILL" ] && echo "old skill path: present" || echo "old skill path: gone"
echo "open handle still reads: $(cat <&9)"
exec 9<&-
echo same-version > README.md; commit readme
codex plugin marketplace upgrade probe 2>&1 | tail -3
show "codex after a commit that keeps 1.0.1"

version 1.0.0; commit back-to-1.0.0
echo "== claude $(claude --version)"
claude plugin marketplace add "http://127.0.0.1:$PORT/mkt.git"  # a local path would load in place, uncopied 2>&1 | tail -3
claude plugin install probe@probe 2>&1 | tail -3
show "claude after install 1.0.0"
version 1.0.1; commit v1.0.1-again
claude plugin marketplace update probe 2>&1 | tail -3
claude plugin update probe@probe 2>&1 | tail -3
show "claude after update to 1.0.1"
for v in "$CC"/*; do [ -f "$v/.orphaned_at" ] && echo "$v/.orphaned_at=$(cat "$v/.orphaned_at")"; done; :
echo "probe dir $T"
