#!/usr/bin/env bash
# Throwaway probe (005-05, questions 1 and 2c). A CLI install that carries its own local marketplace
# (as an npm package would, at <prefix>/lib/node_modules/squeal), added in both harnesses; then the
# install is replaced in place by the next version, as `npm install -g` does. Scratch HOME only.
# Usage: q1b.sh <scratch dir> <pin dir holding v62/ and v72/>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd)
export HOME=$S/home CODEX_HOME=$S/home/.codex DISABLE_AUTOUPDATER=1
unset $(env | grep -oE '^(CLAUDE|CEZ_)[A-Z_]*' ) 2>/dev/null
mkdir -p "$CODEX_HOME"; cd "$S"
step(){ echo; echo "### $*"; }
cx(){ codex "$@" 2>&1 | grep -v '^WARNING'; }
PKG=$S/prefix/lib/node_modules/squeal
put(){ rm -rf "$PKG"; mkdir -p "$PKG/.claude-plugin" "$PKG/.agents/plugins" "$PKG/plugins"
  cp -r "$PIN/v$1/plugins/claude-code" "$PIN/v$1/plugins/codex" "$PKG/plugins/"
  echo '{"name":"hearsay","owner":{"name":"p"},"plugins":[{"name":"squeal","source":"./plugins/claude-code"}]}' > "$PKG/.claude-plugin/marketplace.json"
  echo '{"name":"hearsay","plugins":[{"name":"squeal","source":{"source":"local","path":"./plugins/codex"}}]}' > "$PKG/.agents/plugins/marketplace.json"; }
ipj(){ node -e 'const d=require(process.argv[1]).plugins["squeal@hearsay"]??[];for(const e of d)console.log("  ",e.scope,e.version,e.installPath)' "$HOME/.claude/plugins/installed_plugins.json"; }
put 62
step "add the CLI's own marketplace; install"
claude plugin marketplace add "$PKG" 2>&1 | tail -1
claude plugin install squeal@hearsay 2>&1 | tail -1
ipj; ls "$HOME/.claude/plugins/cache/" 2>&1
cx plugin marketplace add "$PKG" | head -1
cx plugin add squeal@hearsay | tail -1
step "the CLI install is replaced by 0.1.72 in place"
put 72
claude plugin list 2>&1 | grep -A3 squeal | head -4
ipj
echo "  hook file Claude Code would run now: $(grep -o '"version": "[^"]*"' $PKG/plugins/claude-code/.claude-plugin/plugin.json)"
claude plugin update squeal@hearsay 2>&1 | tail -1; ipj
step "Codex: cache before and after plugin list (which schedules an if-version-changed refresh)"
ls "$CODEX_HOME/plugins/cache/hearsay/squeal/"
cx plugin list | grep squeal@; sleep 3
ls "$CODEX_HOME/plugins/cache/hearsay/squeal/"
cx plugin marketplace upgrade hearsay | head -2
cx plugin add squeal@hearsay | tail -1
ls "$CODEX_HOME/plugins/cache/hearsay/squeal/"
