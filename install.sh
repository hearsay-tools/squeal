#!/bin/sh
# Installs Squeal on this machine (spec 005 D3):
#
#   curl -fsSL https://raw.githubusercontent.com/hearsay-tools/squeal/squeal--v<version>/install.sh | sh
#
# For each of claude and codex on the PATH it installs the plugin squeal@hearsay
# at user scope through that harness's own CLI, which makes every write under
# ~/.claude and ~/.codex. Then it copies the plugin's launcher to
# ~/.local/bin/squeal (SQUEAL_BIN_DIR overrides). SQUEAL_MARKETPLACE overrides
# the hub. With pi on the PATH it unpacks the Pi package of this release from
# the tag's source archive into ${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>
# and runs pi install on it, which makes every write under ~/.pi (spec 009 D1);
# an update installs the new directory and pi removes the older ones, but keeps
# the files of the one before it, and of any older one a running process names
# (the daemon of a session still open), so a Pi session open across the update
# still finds its extension's files until /reload loads the new one.
# `sh -s -- --pi` updates only Pi, as squeal update runs it. With opencode on
# the PATH it unpacks the OpenCode package of this release into
# ${XDG_DATA_HOME:-~/.local/share}/squeal/opencode/<version>, points the link
# current beside it there, and runs opencode plugin file:<...>/current -g
# once, which makes every write under OpenCode's config (spec 008 D1); an
# update repoints current, and removes older directories as for Pi.
# `sh -s -- --opencode` updates only OpenCode.
# SQUEAL_SOURCE overrides where the archives are. Each plugin, Pi package and
# launcher it creates is recorded in ${XDG_STATE_HOME:-~/.local/state}/squeal/installed,
# and `sh -s -- --uninstall` removes only those, so one that was there before stays.
#
# Under a pipe stdin is this script, so nothing here reads stdin. Every step
# sits inside main, and the last line calls it with a completion argument after
# the user's: a cut download defines functions, fails to parse, or calls main
# without that argument, and runs nothing (research/wave-0-checks.md 4).
set -eu

# The release this script belongs to; the Pi package comes from its tag.
SQUEAL_VERSION=0.1.258
# Squeal's Node floor, engines.node in package.json (011-86).
NODE_FLOOR=22.19
PLUGIN=squeal@hearsay
HUB=hearsay-tools/marketplace
SOURCE=https://github.com/hearsay-tools/squeal/archive/refs/tags
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
# `codex`, `pi <dir>`, `opencode <dir>`, `opencode` (the config entry opencode
# plugin wrote) or `launcher <path>`, written right after it, so a run that
# fails halfway still owns what it made.
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

# Compares the version node --version prints, the one the failure names, with
# the floor.
check_node() {
  has node || fail "Squeal needs Node $NODE_FLOOR or later, and node is not on the PATH"
  node_version=$(node --version 2>&1) || true
  node -e '
const [a, b] = process.argv[1].replace(/^v/, "").split(".").map(Number);
const [x, y] = process.argv[2].split(".").map(Number);
process.exit(a > x || (a === x && b >= y) ? 0 : 1);
' "$node_version" "$NODE_FLOOR" || fail "Squeal needs Node $NODE_FLOOR or later; this is Node $node_version"
}

# "<version> <dir>" of the newest installed plugin, or nothing. $1: claude (user
# scope only), codex, or any (every Claude Code entry, the Codex cache and the
# Pi and OpenCode packages under $PI_HOME and $OPENCODE_HOME).
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
if (want === "any") {
  for (const packages of [env.PI_HOME, env.OPENCODE_HOME]) {
    try {
      for (const v of readdirSync(packages)) if (/^\d+(\.\d+)*$/.test(v)) found.push([v, join(packages, v)]);
    } catch {}
  }
}
const newest = found.sort((a, b) => compare(a[0], b[0])).at(-1);
if (newest) console.log(`${newest[0]} ${newest[1]}`);
' "$1"
}

# Whether Pi's user settings list the local package $1. Pi stores a local
# source relative to its agent directory and resolves it from there.
pi_has() {
  node -e '
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");
const env = process.env;
const home = env.HOME || homedir();
let dir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
if (dir === "~") dir = home;
else if (dir.startsWith("~/")) dir = join(home, dir.slice(2));
let packages = [];
try {
  packages = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).packages ?? [];
} catch {}
const want = resolve(process.argv[1]);
const listed = packages.some((p) => {
  const source = typeof p === "string" ? p : p?.source;
  return typeof source === "string" && !/^(npm|git|https?|ssh):/.test(source) && resolve(dir, source) === want;
});
process.exit(listed ? 0 : 1);
' "$1"
}

# Whether OpenCode's global config lists the plugin spec file:$1. OpenCode
# reads opencode.json, opencode.jsonc and config.json there; a JSONC file that
# JSON cannot parse is searched for the spec as JSON writes it.
opencode_has() {
  node -e '
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const dir = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME || homedir(), ".config"), "opencode");
const want = `file:${process.argv[1]}`;
const listed = ["opencode.json", "opencode.jsonc", "config.json"].some((name) => {
  let text;
  try {
    text = readFileSync(join(dir, name), "utf8");
  } catch {
    return false;
  }
  try {
    const plugins = JSON.parse(text).plugin ?? [];
    return plugins.some((p) => (Array.isArray(p) ? p[0] : p) === want);
  } catch {
    return text.includes(JSON.stringify(want));
  }
});
process.exit(listed ? 0 : 1);
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

# Unpacks this release's plugins/$1/ into $3, under $2, from the tag's source
# archive; $4 names the harness.
unpack() {
  has curl || fail "installing Squeal in $4 needs curl, and curl is not on the PATH"
  archive="$SOURCE/squeal--v$SQUEAL_VERSION.tar.gz"
  run mkdir -p "$2"
  TMP_DIR=$(mktemp -d "$2/.unpack.XXXXXX")
  run curl -fsSL -o "$TMP_DIR/source.tar.gz" "$archive" || fail "downloading $archive failed"
  mkdir "$TMP_DIR/source"
  run tar -xzf "$TMP_DIR/source.tar.gz" -C "$TMP_DIR/source" --strip-components=1 ||
    fail "unpacking $archive failed"
  package="$TMP_DIR/source/plugins/$1"
  version=$(node -e 'try { console.log(require(process.argv[1]).version ?? "") } catch { console.log("") }' "$package/package.json")
  [ "$version" = "$SQUEAL_VERSION" ] ||
    fail "$archive holds no $4 package of squeal $SQUEAL_VERSION at plugins/$1"
  run mv "$package" "$3"
  rm -rf "$TMP_DIR"
  TMP_DIR=
}

# Installs this release in Pi, then removes each older package this script installed.
install_pi() {
  dir="$PI_HOME/$SQUEAL_VERSION"
  if pi_has "$dir" && [ -f "$dir/package.json" ]; then
    say "Pi has Squeal $SQUEAL_VERSION from $dir"
  else
    if [ ! -f "$dir/package.json" ]; then
      [ ! -e "$dir" ] || run rm -rf "$dir"
      unpack pi "$PI_HOME" "$dir" Pi
      record "pi $dir"
    fi
    run pi install "$dir" || fail "pi install $dir failed"
  fi
  # The function's arguments become the recorded directories, split on newlines only.
  set -f
  IFS='
'
  set -- $(owned pi)
  unset IFS
  set +f
  keep=$(previous "$dir" "$@")
  removed=no
  for old in "$@"; do
    [ "$old" = "$dir" ] && continue
    if pi_has "$old"; then
      run pi remove "$old" || fail "pi remove $old failed"
      removed=yes
    fi
    [ "$old" = "$keep" ] && continue
    if in_use "$old"; then
      say "Kept $old: a running process uses it"
      continue
    fi
    run rm -rf "$old"
    forget "pi $old"
  done
  if [ "$removed" = yes ]; then
    # Only one previous version is kept for a session with no running daemon (spec 009 D1).
    say "Pi sessions already open keep the Squeal they loaded; /reload in each loads $SQUEAL_VERSION. Reload them before the next update: it removes the version they loaded unless its daemon is running"
  fi
}

# Installs this release in OpenCode: the directory, current pointed at it, and
# opencode plugin on current only when OpenCode's config does not list it yet,
# since a second file: entry would load Squeal twice. Then removes each older
# directory this script unpacked, as for Pi.
install_opencode() {
  dir="$OPENCODE_HOME/$SQUEAL_VERSION"
  link="$OPENCODE_HOME/current"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    fail "$link exists and is not a link; move it, then run this again"
  fi
  if [ ! -f "$dir/package.json" ]; then
    [ ! -e "$dir" ] || run rm -rf "$dir"
    unpack opencode "$OPENCODE_HOME" "$dir" OpenCode
    record "opencode $dir"
  fi
  was=$(readlink "$link" 2>/dev/null) || was=
  [ "$was" = "$SQUEAL_VERSION" ] || run ln -sfn "$SQUEAL_VERSION" "$link"
  if ! opencode_has "$link"; then
    run opencode plugin "file:$link" -g || fail "opencode plugin file:$link -g failed"
    record opencode
  elif [ "$was" = "$SQUEAL_VERSION" ]; then
    say "OpenCode has Squeal $SQUEAL_VERSION from $dir"
  fi
  # The function's arguments become the recorded directories, split on newlines only.
  set -f
  IFS='
'
  set -- $(owned opencode)
  unset IFS
  set +f
  keep=$(previous "$dir" "$@")
  for old in "$@"; do
    [ "$old" = "$dir" ] && continue
    [ "$old" = "$keep" ] && continue
    if in_use "$old"; then
      say "Kept $old: a running process uses it"
      continue
    fi
    run rm -rf "$old"
    forget "opencode $old"
  done
  if [ -n "$was" ] && [ "$was" != "$SQUEAL_VERSION" ]; then
    # OpenCode loads the plugin from current's target at its start (research/wave-0-checks.md 3).
    say "OpenCode sessions already open keep the Squeal they loaded until they restart. Restart them before the next update: it removes the version they loaded unless its daemon is running"
  fi
}

# The newest recorded directory other than $1, by its version, which an update keeps.
previous() {
  node -e '
const [dir, ...dirs] = process.argv.slice(1);
const v = (d) => d.split("/").at(-1).split(".").map(Number);
const newer = (a, b) => {
  const x = v(a);
  const y = v(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};
const keep = dirs.filter((d) => d !== dir).reduce((a, b) => (a === undefined || newer(b, a) ? b : a), undefined);
if (keep) console.log(keep);
' "$@"
}

# Whether a running process names a file under $1, as a daemon spawned from it
# does. Matched in this shell, since a grep would name $1 itself.
in_use() {
  procs=$(ps -A -o args= 2>/dev/null) || return 1
  case "$procs" in
  *"$1/"*) return 0 ;;
  esac
  return 1
}

# Every package directory of $1 (pi or opencode) the record holds, one per line.
owned() {
  [ ! -f "$OWNED" ] || sed -n "s/^$1 //p" "$OWNED"
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
  has claude || has codex || has pi || has opencode ||
    fail "none of claude, codex, pi and opencode is on the PATH: install Claude Code, Codex, Pi or OpenCode first"
  if has claude; then install_in claude "Claude Code" install; fi
  if has codex; then install_in codex Codex add; fi
  if has pi; then install_pi; fi
  if has opencode; then install_opencode; fi
  copy_launcher
  say "Next, in each repository: squeal setup"
}

# squeal update's Pi step: this release in Pi and nothing else; squeal update copies the launcher.
install_pi_only() {
  check_node
  has pi || fail "pi is not on the PATH"
  install_pi
}

# squeal update's OpenCode step, as the Pi one.
install_opencode_only() {
  check_node
  has opencode || fail "opencode is not on the PATH"
  install_opencode
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

uninstall_pi() {
  # The function's arguments become the recorded directories, split on newlines only.
  set -f
  IFS='
'
  set -- $(owned pi)
  unset IFS
  set +f
  for dir in "$@"; do
    if ! has pi; then
      say "pi is not on the PATH, so Squeal stays in Pi from $dir, and in $OWNED"
      continue
    fi
    if pi_has "$dir"; then run pi remove "$dir" || fail "pi remove $dir failed"; fi
    run rm -rf "$dir"
    forget "pi $dir"
  done
  dir="$PI_HOME/$SQUEAL_VERSION"
  if has pi && ! owns "pi $dir" && pi_has "$dir"; then
    say "Pi had Squeal from $dir before install.sh ran, so it stays; pi remove $dir removes it"
  fi
  rmdir "$PI_HOME" "${PI_HOME%/*}" 2>/dev/null || true
}

# Removes the OpenCode directories this script unpacked, and current once it
# names none. OpenCode has no command that removes a plugin and this script
# never edits OpenCode's config, so the entry opencode plugin wrote stays, and
# is named; OpenCode starts normally with it (research/wave-0-checks.md 3).
uninstall_opencode() {
  link="$OPENCODE_HOME/current"
  # The function's arguments become the recorded directories, split on newlines only.
  set -f
  IFS='
'
  set -- $(owned opencode)
  unset IFS
  set +f
  for dir in "$@"; do
    run rm -rf "$dir"
    forget "opencode $dir"
  done
  if [ -L "$link" ] && [ ! -e "$link" ]; then run rm "$link"; fi
  dir="$OPENCODE_HOME/$SQUEAL_VERSION"
  if [ -e "$dir" ]; then
    say "OpenCode had Squeal from $dir before install.sh ran, so it stays"
  fi
  if owns opencode; then
    if opencode_has "$link"; then
      config=${XDG_CONFIG_HOME:-$HOME/.config}/opencode
      say "OpenCode's global config in $config still lists file:$link. OpenCode has no command that removes a plugin and install.sh does not edit its config, so delete that entry yourself; until then OpenCode starts as before, without Squeal"
    fi
    forget opencode
  fi
  rmdir "$OPENCODE_HOME" "${OPENCODE_HOME%/*}" 2>/dev/null || true
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
  uninstall_pi
  uninstall_opencode
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
  SOURCE=${SQUEAL_SOURCE:-$SOURCE}
  PI_HOME=${XDG_DATA_HOME:-$HOME/.local/share}/squeal/pi
  OPENCODE_HOME=${XDG_DATA_HOME:-$HOME/.local/share}/squeal/opencode
  export PI_HOME OPENCODE_HOME
  # A failed unpack leaves no download behind.
  TMP_DIR=
  trap '[ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"' EXIT
  case "$*" in
  "$COMPLETE") install ;;
  "--uninstall $COMPLETE") uninstall ;;
  "--pi $COMPLETE") install_pi_only ;;
  "--opencode $COMPLETE") install_opencode_only ;;
  *)
    say "usage: install.sh [--uninstall | --pi | --opencode]" >&2
    exit 2
    ;;
  esac
}

main "$@" squeal-install-complete
