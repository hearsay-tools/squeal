#!/bin/sh
# Installs Squeal on this machine (spec 005 D3):
#
#   curl -fsSL https://raw.githubusercontent.com/hearsay-tools/squeal/squeal--v<version>/install.sh | sh
#
# For each of claude and codex on the PATH it installs the plugin squeal@hearsay
# at user scope through that harness's own CLI, which makes every write under
# ~/.claude and ~/.codex. Then it copies the plugin's launcher to
# ~/.local/bin/squeal (SQUEAL_BIN_DIR overrides). SQUEAL_MARKETPLACE overrides
# the hub. Each plugin and launcher it creates is recorded in
# ${XDG_STATE_HOME:-~/.local/state}/squeal/installed, and `sh -s -- --uninstall`
# removes only those, so a plugin or launcher that was there before stays.
#
# Under a pipe stdin is this script, so nothing here reads stdin. Every step
# sits inside main, and the last line calls it with a completion argument after
# the user's: a cut download defines functions, fails to parse, or calls main
# without that argument, and runs nothing (research/wave-0-checks.md 4).
set -eu

PLUGIN=squeal@hearsay
HUB=hearsay-tools/marketplace
MARKER="squeal-launcher format"
COMPLETE=squeal-install-complete

say() { printf '%s\n' "$*"; }
fail() {
  printf 'squeal install: %s\n' "$*" >&2
  exit 1
}
# Prints the command, then runs it.
run() {
  say "\$ $*"
  "$@"
}
has() { command -v "$1" >/dev/null 2>&1; }

# The ownership record: one line per resource this script created, `claude`,
# `codex` or `launcher <path>`, written right after it, so a run that fails
# halfway still owns what it made.
owns() { [ -f "$OWNED" ] && grep -qxF "$1" "$OWNED"; }
record() {
  owns "$1" && return 0
  mkdir -p "${OWNED%/*}"
  printf '%s\n' "$1" >>"$OWNED"
}
forget() {
  owns "$1" || return 0
  grep -vxF "$1" "$OWNED" >"$OWNED.new" || true
  if [ -s "$OWNED.new" ]; then
    mv "$OWNED.new" "$OWNED"
  else
    rm -f "$OWNED.new" "$OWNED"
    rmdir "${OWNED%/*}" 2>/dev/null || true
  fi
}

check_node() {
  has node || fail "Squeal needs Node 22.13 or later, and node is not on the PATH"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' ||
    fail "Squeal needs Node 22.13 or later; this is Node $(node --version)"
}

# "<version> <dir>" of the newest installed plugin, or nothing. $1: claude (user
# scope only), codex, or any (every Claude Code entry and the Codex cache).
installed() {
  node -e '
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const env = process.env;
const home = env.HOME ?? "";
const want = process.argv[1];
const compare = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};
const found = [];
if (want !== "codex") {
  try {
    const config = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
    const file = JSON.parse(readFileSync(join(config, "plugins", "installed_plugins.json"), "utf8"));
    for (const e of file.plugins?.["squeal@hearsay"] ?? []) {
      if (want === "claude" && e.scope !== "user") continue;
      if (typeof e.version === "string" && typeof e.installPath === "string" && existsSync(e.installPath))
        found.push([e.version, e.installPath]);
    }
  } catch {}
}
if (want !== "claude") {
  const cache = join(env.CODEX_HOME ?? join(home, ".codex"), "plugins", "cache", "hearsay", "squeal");
  try {
    for (const v of readdirSync(cache)) if (/^\d+(\.\d+)*$/.test(v)) found.push([v, join(cache, v)]);
  } catch {}
}
const newest = found.sort((a, b) => compare(a[0], b[0])).at(-1);
if (newest) console.log(`${newest[0]} ${newest[1]}`);
' "$1"
}

# The hub is private until a public release (spec 005 open question 11).
hub_failed() {
  if [ "$MARKETPLACE" = "$HUB" ]; then
    fail "adding the marketplace $HUB to $1 failed. The hub is private for now: installing Squeal needs access to github.com/$HUB. With access, check that git can clone it (an SSH key, or gh auth login), then run this again."
  fi
  fail "adding the marketplace $MARKETPLACE to $1 failed"
}

# $1: claude or codex; $2: its name; $3: its install subcommand.
install_in() {
  current=$(installed "$1")
  if [ -n "$current" ]; then
    say "$2 has $PLUGIN ${current%% *}; squeal update updates it"
    return 0
  fi
  # A marketplace added by an earlier run fails to add again; the install then shows whether it is there.
  added=yes
  run "$1" plugin marketplace add "$MARKETPLACE" || added=no
  if ! run "$1" plugin "$3" "$PLUGIN"; then
    [ "$added" = yes ] || hub_failed "$2"
    fail "installing $PLUGIN in $2 failed"
  fi
  record "$1"
}

is_launcher() { [ -f "$1" ] && grep -q "^# $MARKER " "$1"; }

copy_launcher() {
  newest=$(installed any)
  [ -n "$newest" ] || fail "no installed $PLUGIN found after installing it"
  from="${newest#* }/bin/squeal-launcher"
  [ -f "$from" ] || fail "the installed plugin at ${newest#* } has no bin/squeal-launcher"
  to="$BIN_DIR/squeal"
  if [ -e "$to" ] && ! is_launcher "$to"; then
    fail "$to exists and is not Squeal's launcher; move it, or set SQUEAL_BIN_DIR to another directory"
  fi
  if [ -f "$to" ] && cmp -s "$from" "$to"; then
    say "$to is the launcher of $PLUGIN ${newest%% *}"
  else
    # A launcher that was already there is updated, and stays the user's.
    [ -e "$to" ] && existed=yes || existed=no
    run mkdir -p "$BIN_DIR"
    run cp "$from" "$to"
    run chmod 755 "$to"
    [ "$existed" = yes ] || record "launcher $to"
  fi
  case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "$BIN_DIR is not on your PATH. Add it in your shell's profile: export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
}

install() {
  check_node
  has claude || has codex || fail "neither claude nor codex is on the PATH: install Claude Code or Codex first"
  if has claude; then install_in claude "Claude Code" install; fi
  if has codex; then install_in codex Codex add; fi
  copy_launcher
  say "Next, in each repository: squeal setup"
}

# $1: claude or codex; $2: its name; $3: its remove subcommand.
uninstall_in() {
  has "$1" || {
    owns "$1" && say "$1 is not on the PATH, so $PLUGIN stays in $2 and in $OWNED"
    return 0
  }
  [ -n "$(installed "$1")" ] || {
    forget "$1"
    return 0
  }
  if owns "$1"; then
    run "$1" plugin "$3" "$PLUGIN"
    forget "$1"
  else
    say "$2 had $PLUGIN before install.sh ran, so it stays; $1 plugin $3 $PLUGIN removes it"
  fi
}

uninstall() {
  to="$BIN_DIR/squeal"
  if ! is_launcher "$to"; then
    [ ! -e "$to" ] || say "$to is not Squeal's launcher; left as it is"
    forget "launcher $to"
  elif owns "launcher $to"; then
    run rm "$to"
    forget "launcher $to"
  else
    say "$to was there before install.sh ran, so it stays; rm $to removes it"
  fi
  uninstall_in claude "Claude Code" uninstall
  uninstall_in codex Codex remove
  say "The hearsay marketplace stays added; claude plugin marketplace remove hearsay and codex plugin marketplace remove hearsay remove it."
}

main() {
  case " $* " in
  *" $COMPLETE ") ;;
  *) fail "this copy of install.sh ends early, as a cut download does, so it ran nothing; download it again" ;;
  esac
  MARKETPLACE=${SQUEAL_MARKETPLACE:-$HUB}
  BIN_DIR=${SQUEAL_BIN_DIR:-$HOME/.local/bin}
  OWNED=${XDG_STATE_HOME:-$HOME/.local/state}/squeal/installed
  case "$*" in
  "$COMPLETE") install ;;
  "--uninstall $COMPLETE") uninstall ;;
  *)
    say "usage: install.sh [--uninstall]" >&2
    exit 2
    ;;
  esac
}

main "$@" squeal-install-complete
